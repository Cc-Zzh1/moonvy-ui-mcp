import { gunzipSync, inflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { findNodeWithParent, getGenomePages } from './genome.js';

const DEFAULT_API_BASE = 'https://global-api.moonvy.com/v2';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_GENOME_BYTES = 50 * 1024 * 1024;
const genomeCache = new Map();

export function normalizeToken(value) {
  return String(value ?? '').trim().replace(/^Bearer\s+/i, '').trim();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function config() {
  return {
    apiBase: String(process.env.MOONVY_API_BASE || DEFAULT_API_BASE).replace(/\/$/, ''),
    token: normalizeToken(process.env.MOONVY_TOKEN),
    cacheTtlMs: positiveInteger(process.env.MOONVY_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS),
    maxGenomeBytes: positiveInteger(process.env.MOONVY_MAX_GENOME_BYTES, DEFAULT_MAX_GENOME_BYTES),
  };
}

export function parseMoonvyUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error('Invalid Moonvy URL.');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'moonvy.com' && !hostname.endsWith('.moonvy.com')) {
    throw new Error('URL host must be moonvy.com.');
  }
  const match = url.pathname.match(/^\/project\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?\/?$/);
  if (!match) {
    throw new Error('Expected Moonvy URL format: /project/:projectId/:dirId/:fileId');
  }
  return {
    projectId: decodeURIComponent(match[1]),
    dirId: match[2] ? decodeURIComponent(match[2]) : null,
    fileId: match[3] ? decodeURIComponent(match[3]) : null,
    cleanUrl: `${url.origin}${url.pathname}`,
  };
}

function requireToken() {
  const token = config().token;
  if (!token) {
    throw new Error('MOONVY_TOKEN is missing. Copy the JWT from an already logged-in Moonvy page into a local .env file.');
  }
  return token;
}

function redactMessage(message) {
  return String(message)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]');
}

export async function moonvyApi(path, body) {
  const settings = config();
  const response = await fetch(`${settings.apiBase}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${requireToken()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Moonvy API ${path} returned HTTP ${response.status}: ${redactMessage(text.slice(0, 400))}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Moonvy API ${path} returned non-JSON data.`);
  }
}

function objectCandidates(value) {
  return [
    value,
    value?.data,
    value?.result,
    value?.data?.data,
    value?.result?.data,
    value?.node,
    value?.data?.node,
  ].filter((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
}

function unwrapNode(value) {
  const candidates = objectCandidates(value);
  return candidates.find((candidate) => candidate.files || candidate.preview || candidate.meta)
    ?? candidates.find((candidate) => candidate.id || candidate.nodeId)
    ?? value;
}

function extractItems(response) {
  const candidates = [
    response,
    response?.data,
    response?.result,
    response?.list,
    response?.items,
    response?.records,
    response?.rows,
    response?.data?.list,
    response?.data?.items,
    response?.data?.records,
    response?.data?.rows,
    response?.result?.list,
    response?.result?.items,
    response?.result?.records,
  ];
  return candidates.find(Array.isArray) ?? [];
}

export async function fetchNodeFull(projectId, nodeId) {
  if (!projectId || !nodeId) throw new Error('projectId and nodeId are required.');
  return unwrapNode(await moonvyApi('/anynode/get', { projectId, id: nodeId, lv: 'full' }));
}

function parseGenomeBuffer(buffer) {
  const attempts = [
    () => buffer,
    () => gunzipSync(buffer),
    () => inflateSync(buffer),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      const text = attempt().toString('utf8').replace(/^\uFEFF/, '').trim();
      if (!text.startsWith('{') && !text.startsWith('[')) continue;
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not decode Moonvy genome JSON${lastError ? `: ${lastError.message}` : '.'}`);
}

export async function fetchGenome(genomeUrl) {
  const settings = config();
  const cached = genomeCache.get(genomeUrl);
  if (cached && Date.now() - cached.loadedAt < settings.cacheTtlMs) return cached.value;

  const response = await fetch(genomeUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Genome download returned HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > settings.maxGenomeBytes) {
    throw new Error(`Genome exceeds configured limit of ${settings.maxGenomeBytes} bytes.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > settings.maxGenomeBytes) {
    throw new Error(`Genome exceeds configured limit of ${settings.maxGenomeBytes} bytes.`);
  }
  const value = parseGenomeBuffer(buffer);
  genomeCache.set(genomeUrl, { loadedAt: Date.now(), value });
  return value;
}

export async function getDesignData(url) {
  const ids = parseMoonvyUrl(url);
  const nodeId = ids.fileId ?? ids.dirId;
  if (!nodeId) throw new Error('The URL points to a project root; a design file URL is required.');
  const node = await fetchNodeFull(ids.projectId, nodeId);
  const genomeUrl = node?.files?.genome?.url ?? node?.file?.genome?.url;
  if (!genomeUrl) throw new Error('The selected Moonvy node has no genome file. It may be a folder instead of a design file.');
  return { ids, node, genome: await fetchGenome(genomeUrl) };
}

function normalizeTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  return String(value);
}

function pick(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function normalizeListItem(item, ids, scopeId) {
  const id = pick(item, ['id', 'nodeId', 'fileId', '_id', 'uuid']);
  if (!id) return null;
  const parentId = pick(item, ['parentId', 'pid', 'dirId', 'folderId', 'parent_id']) ?? scopeId;
  const itemId = String(id);
  return {
    id: itemId,
    name: String(pick(item, ['name', 'title', 'displayName']) ?? ''),
    type: String(pick(item, ['type', 'nodeType', 'kind', 'fileType']) ?? ''),
    parentId: parentId ? String(parentId) : null,
    projectId: ids.projectId,
    url: parentId && String(parentId) !== itemId
      ? `https://moonvy.com/project/${ids.projectId}/${parentId}/${itemId}`
      : `https://moonvy.com/project/${ids.projectId}/${itemId}`,
    createdAt: normalizeTime(pick(item, ['createdAt', 'created_at', 'createTime', 'ctime'])),
    updatedAt: normalizeTime(pick(item, ['updatedAt', 'updated_at', 'updateTime', 'mtime'])),
  };
}

function canHaveChildren(type) {
  return ['any', 'dir', 'directory', 'folder'].includes(String(type).toLowerCase());
}

function hasMorePages(response, pageIndex, itemCount) {
  const containers = objectCandidates(response);
  for (const object of containers) {
    if (object.hasNext === false || object.hasMore === false) return false;
    const totalPages = Number(object.totalPages ?? object.pageCount);
    if (Number.isFinite(totalPages) && pageIndex + 1 >= totalPages) return false;
    const pageSize = Number(object.pageSize ?? object.limit);
    if (Number.isFinite(pageSize) && itemCount < pageSize) return false;
  }
  return itemCount > 0;
}

export async function listProjectNodes(url, options = {}) {
  const ids = parseMoonvyUrl(url);
  const limit = Math.min(Math.max(Number(options.limit ?? 500), 1), 2_000);
  const maxApiPages = Math.min(Math.max(Number(options.maxApiPages ?? 50), 1), 200);
  const initialScope = ids.fileId ? ids.dirId : ids.dirId;
  const queue = [initialScope ?? null];
  const queued = new Set(queue.map((value) => value ?? 'project'));
  const seen = new Set();
  const nodes = [];
  let apiPages = 0;

  while (queue.length > 0 && nodes.length < limit && apiPages < maxApiPages) {
    const scopeId = queue.shift();
    for (let pageIndex = 0; nodes.length < limit && apiPages < maxApiPages; pageIndex += 1) {
      apiPages += 1;
      const body = { projectId: ids.projectId, pageIndex };
      if (scopeId) body.id = scopeId;
      const response = await moonvyApi('/anynode/list', body);
      const items = extractItems(response);
      if (items.length === 0) break;
      for (const item of items) {
        const normalized = normalizeListItem(item, ids, scopeId);
        if (!normalized) continue;
        if (canHaveChildren(normalized.type) && !queued.has(normalized.id)) {
          queued.add(normalized.id);
          queue.push(normalized.id);
        }
        if (!seen.has(normalized.id)) {
          seen.add(normalized.id);
          nodes.push(normalized);
        }
        if (nodes.length >= limit) break;
      }
      if (!hasMorePages(response, pageIndex, items.length)) break;
    }
  }
  return { nodes, truncated: nodes.length >= limit || apiPages >= maxApiPages, apiPages };
}

function sanitizeFilename(value) {
  const safe = String(value || 'asset')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120);
  return safe || 'asset';
}

function assetExtension(url, contentType, fallback = '') {
  if (contentType.includes('svg')) return '.svg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('jpeg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  const match = new URL(url).pathname.match(/\.(svg|png|jpe?g|webp|gif)$/i);
  return match?.[0]?.toLowerCase() ?? fallback;
}

function findParent(genome, targetNode) {
  return findNodeWithParent(genome, targetNode?.id)?.parent ?? null;
}

function resolveLayerAsset(nodeMeta, genome, layer, requestedType, sliceFormat) {
  const assets = nodeMeta?.meta?.assets ?? {};
  const images = genome?.images ?? {};
  const type = requestedType
    ?? (layer.slices ? 'slice' : layer.snapshot || layer.snapshotPreview ? 'snapshot' : 'image');
  let hash;
  let extension = '';
  let resolvedLayer = layer;

  if (type === 'slice') {
    const format = sliceFormat ?? 'svg';
    const slice = layer.slices?.[format] ?? layer.slices?.max ?? layer.slices?.base;
    hash = slice?.id ?? slice?.hash;
    extension = format === 'svg' ? '.svg' : '.png';
  } else if (type === 'snapshot') {
    hash = layer.snapshot ?? layer.snapshotPreview;
    while (!hash && resolvedLayer) {
      resolvedLayer = findParent(genome, resolvedLayer);
      hash = resolvedLayer?.snapshot ?? resolvedLayer?.snapshotPreview;
    }
    extension = '.png';
  } else if (type === 'image') {
    const fill = (layer.fills ?? []).find((candidate) => candidate.type === 'image');
    hash = fill?.imageHash ?? fill?.hash ?? fill?.id;
    extension = images?.[hash]?.type ? `.${images[hash].type}` : '.png';
  } else {
    throw new Error(`Unsupported asset type: ${type}`);
  }
  if (!hash) throw new Error(`Node does not expose a ${type} asset.`);
  return {
    type,
    name: resolvedLayer?.name ?? layer.name ?? 'asset',
    url: assets[hash] ?? images?.[hash]?.url ?? `https://fs.moonvy.com/${hash}`,
    extension,
  };
}

export async function downloadAsset(url, nodeId, options = {}) {
  const ids = parseMoonvyUrl(url);
  if (!options.outputDir || !isAbsolute(options.outputDir)) {
    throw new Error('outputDir must be an absolute path.');
  }
  let asset;
  if (!String(nodeId).includes(':')) {
    const node = await fetchNodeFull(ids.projectId, nodeId);
    const requestedType = options.type ?? 'file';
    const assetUrl = requestedType === 'snapshot'
      ? node?.preview?.large ?? node?.preview?.normal
      : node?.files?.file?.url ?? node?.preview?.large ?? node?.preview?.normal;
    if (!assetUrl) throw new Error('The Moonvy node has no downloadable file or preview.');
    asset = { type: requestedType, name: node.name ?? 'asset', url: assetUrl, extension: '' };
  } else {
    const data = await getDesignData(url);
    const found = findNodeWithParent(data.genome, nodeId);
    if (!found) throw new Error(`Node ${nodeId} was not found in the design genome.`);
    asset = resolveLayerAsset(data.node, data.genome, found.node, options.type, options.sliceFormat);
  }

  const response = await fetch(asset.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Asset download returned HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? '';
  const extension = assetExtension(asset.url, contentType, asset.extension);
  let filename = sanitizeFilename(options.filename ?? asset.name);
  if (!extname(filename) && extension) filename += extension;
  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, filename);
  await writeFile(outputPath, buffer);
  return { success: true, path: outputPath, filename, bytes: buffer.length, contentType, type: asset.type };
}

export function clearGenomeCache() {
  genomeCache.clear();
}

export function designFrameIds(genome) {
  return getGenomePages(genome).map((page) => String(page.id ?? '')).filter(Boolean);
}
