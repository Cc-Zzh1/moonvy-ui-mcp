#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import {
  buildTree,
  extractDesignMeta,
  extractNodeStyle,
  extractTokens,
  findNodeWithParent,
  flattenGenome,
} from './genome.js';
import {
  clearGenomeCache,
  downloadAsset,
  getDesignData,
  listProjectNodes,
  parseMoonvyUrl,
} from './moonvy-client.js';

const server = new McpServer(
  { name: 'moonvy-ui-mcp', version: '0.1.2' },
  {
    instructions: [
      'Only read Moonvy projects the user is authorized to access. If a URL contains only projectId/dirId, call moonvy_list_pages first and select a concrete design file URL.',
      'For frontend implementation, call moonvy_get_design, then moonvy_get_ui_spec with a bounded maxDepth/maxNodes. Use moonvy_list_layers plus moonvy_get_node_style for exact element details.',
      'Preserve returned color, typography, spacing, radius, and CSS values instead of visually guessing. Use moonvy_download_asset only when the user asks to save design assets locally.',
    ].join(' '),
  },
);

const SENSITIVE_KEY_RE = /(^|[_-])(access[_-]?token|authorization|cookie|cookies|credential|credentials|csrf|jwt|password|private[_-]?key|refresh[_-]?token|secret|session|token)([_-]|$)/i;

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return String(value);
  }
}

function redact(value, key = '') {
  if (SENSITIVE_KEY_RE.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  if (typeof value === 'string') {
    if (/url$/i.test(key) || key === 'preview') return sanitizeUrl(value);
    return value
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]');
  }
  return value;
}

function ok(value) {
  return { content: [{ type: 'text', text: JSON.stringify(redact(value), null, 2) }] };
}

function failed(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: `Moonvy MCP error: ${redact(error?.message ?? error)}` }],
  };
}

function handler(fn) {
  return async (args) => {
    try {
      return ok(await fn(args));
    } catch (error) {
      return failed(error);
    }
  };
}

const designUrl = z.string().url().describe('Moonvy URL, normally /project/:projectId/:dirId/:fileId');
const frameId = z.string().optional().describe('Optional Moonvy/Figma-style frame ID');

server.registerTool('moonvy_parse_url', {
  title: 'Parse Moonvy URL',
  description: 'Validate a Moonvy URL and return project, directory, and file IDs. Does not require authentication.',
  inputSchema: { url: designUrl },
}, handler(async ({ url }) => parseMoonvyUrl(url)));

server.registerTool('moonvy_list_pages', {
  title: 'List Moonvy project pages',
  description: 'List folders and design files below a Moonvy project or directory URL. Call this first when only a project URL is known.',
  inputSchema: {
    url: designUrl,
    limit: z.number().int().min(1).max(2_000).default(500),
    maxApiPages: z.number().int().min(1).max(200).default(50),
  },
}, handler(async ({ url, limit, maxApiPages }) => listProjectNodes(url, { limit, maxApiPages })));

server.registerTool('moonvy_get_design', {
  title: 'Get Moonvy design metadata',
  description: 'Return the design title, genome version, frame IDs, frame dimensions, and child counts for a Moonvy design URL.',
  inputSchema: { url: designUrl },
}, handler(async ({ url }) => {
  const { node, genome } = await getDesignData(url);
  return extractDesignMeta(genome, node);
}));

server.registerTool('moonvy_list_layers', {
  title: 'List Moonvy layers',
  description: 'Return a flat layer index with node IDs, names, types, depth, source bounds, and correctly normalized parent-relative positions. Use it to find a node ID before requesting exact style.',
  inputSchema: {
    url: designUrl,
    frameId,
    maxNodes: z.number().int().min(1).max(20_000).default(2_000),
    includeHidden: z.boolean().default(false),
  },
}, handler(async ({ url, frameId: selectedFrame, maxNodes, includeHidden }) => {
  const { genome } = await getDesignData(url);
  return flattenGenome(genome, { frameId: selectedFrame, maxNodes, includeHidden });
}));

server.registerTool('moonvy_get_node_style', {
  title: 'Get exact Moonvy node style',
  description: 'Return one node’s size, coordinates, distances to parent edges, fills, typography, borders, radius, effects, opacity, visibility, and directly usable CSS declarations.',
  inputSchema: {
    url: designUrl,
    nodeId: z.string().min(1).describe('Moonvy/Figma-style node ID, e.g. 4:1224'),
  },
}, handler(async ({ url, nodeId }) => {
  const { genome } = await getDesignData(url);
  const found = findNodeWithParent(genome, nodeId);
  if (!found) throw new Error(`Node ${nodeId} was not found.`);
  return {
    id: String(found.node.id ?? ''),
    name: String(found.node.name ?? ''),
    type: String(found.node.type ?? ''),
    parentId: found.parent?.id ? String(found.parent.id) : null,
    style: extractNodeStyle(genome, found.node, found.parent),
  };
}));

server.registerTool('moonvy_get_tree', {
  title: 'Get Moonvy layer tree',
  description: 'Return the nested design layer tree. Styles include exact UI values and CSS. Limit depth and node count to keep model context compact.',
  inputSchema: {
    url: designUrl,
    frameId,
    withStyle: z.boolean().default(true),
    maxDepth: z.number().int().min(0).max(99).default(8),
    maxNodes: z.number().int().min(1).max(20_000).default(2_000),
    includeHidden: z.boolean().default(false),
  },
}, handler(async ({ url, frameId: selectedFrame, withStyle, maxDepth, maxNodes, includeHidden }) => {
  const { genome } = await getDesignData(url);
  return buildTree(genome, { frameId: selectedFrame, withStyle, maxDepth, maxNodes, includeHidden });
}));

server.registerTool('moonvy_extract_tokens', {
  title: 'Extract Moonvy design tokens',
  description: 'Extract reusable colors, gradients, fonts, text metrics, radii, inferred padding/gaps, and shadows from a design.',
  inputSchema: { url: designUrl },
}, handler(async ({ url }) => {
  const { genome } = await getDesignData(url);
  return extractTokens(genome);
}));

server.registerTool('moonvy_get_ui_spec', {
  title: 'Get frontend-ready Moonvy UI spec',
  description: 'Recommended development tool: return design metadata, inferred design tokens, and a styled component tree in one response. Use frameId/maxDepth/maxNodes to control context size.',
  inputSchema: {
    url: designUrl,
    frameId,
    maxDepth: z.number().int().min(0).max(99).default(6),
    maxNodes: z.number().int().min(1).max(10_000).default(1_000),
    includeHidden: z.boolean().default(false),
  },
}, handler(async ({ url, frameId: selectedFrame, maxDepth, maxNodes, includeHidden }) => {
  const { node, genome } = await getDesignData(url);
  return {
    source: parseMoonvyUrl(url),
    design: extractDesignMeta(genome, node),
    tokens: extractTokens(genome),
    ...buildTree(genome, {
      frameId: selectedFrame,
      withStyle: true,
      maxDepth,
      maxNodes,
      includeHidden,
    }),
    implementationNotes: [
      'Prefer the returned exact CSS values over visual guessing.',
      'Layout numbers use source px; units describes CSS length conversion. Typography.lineHeightUnit and tokens.lineHeightDetails distinguish percentages, px, and automatic line heights; legacy tokens.lineHeights contains values only.',
      'CSS lengths use one unit consistently. Mobile artboards default to rpx using artboardWidth -> 750rpx (for a 375px artboard, 1px = 2rpx).',
      'Percentage line heights and gradient percentages are not lengths and are not multiplied by the px/rpx scale.',
      'relativeX/relativeY are normalized to the parent even when Moonvy stores artboard children in an already-local coordinate space.',
      'Spacing tokens are inferred from normalized parent padding and positive sibling gaps.',
      'Use moonvy_download_asset for slice, snapshot, or image-fill nodes.',
    ],
  };
}));

server.registerTool('moonvy_download_asset', {
  title: 'Download Moonvy asset',
  description: 'Download a design slice, snapshot, image fill, or top-level file/preview into an absolute local output directory.',
  inputSchema: {
    url: designUrl,
    nodeId: z.string().min(1).describe('Layer ID such as 4:1224, or a top-level Moonvy file UUID'),
    type: z.enum(['slice', 'snapshot', 'image', 'file']).optional(),
    sliceFormat: z.string().optional().describe('Requested slice variant such as svg, base, or max'),
    filename: z.string().optional().describe('Optional safe local filename'),
    outputDir: z.string().min(1).describe('Absolute local directory where the asset should be written'),
  },
}, handler(async ({ url, nodeId, type, sliceFormat, filename, outputDir }) => (
  downloadAsset(url, nodeId, { type, sliceFormat, filename, outputDir })
)));

server.registerTool('moonvy_clear_cache', {
  title: 'Clear Moonvy genome cache',
  description: 'Clear the in-memory genome cache after a design has changed and must be fetched again.',
  inputSchema: {},
}, handler(async () => {
  clearGenomeCache();
  return { cleared: true };
}));

const transport = new StdioServerTransport();
await server.connect(transport);
