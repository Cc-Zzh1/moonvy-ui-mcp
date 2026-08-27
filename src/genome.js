const DEFAULT_MAX_NODES = 2_000;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function tidyNumber(value, precision = 4) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const factor = 10 ** precision;
  return Math.round(number * factor) / factor;
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))]
    .sort((a, b) => a - b);
}

function uniqueSortedStrings(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function getRect(node) {
  const rect = node?.rect ?? node?.frame ?? {};
  return {
    x: tidyNumber(rect.x) ?? 0,
    y: tidyNumber(rect.y) ?? 0,
    width: tidyNumber(rect.w ?? rect.width) ?? 0,
    height: tidyNumber(rect.h ?? rect.height) ?? 0,
  };
}

function rgbaChannels(color = {}) {
  let r = finiteNumber(color.r) ?? 0;
  let g = finiteNumber(color.g) ?? 0;
  let b = finiteNumber(color.b) ?? 0;
  const normalized = r <= 1 && g <= 1 && b <= 1;
  if (normalized) {
    r *= 255;
    g *= 255;
    b *= 255;
  }
  return {
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
    a: Math.max(0, Math.min(1, finiteNumber(color.a) ?? 1)),
  };
}

export function colorToCss(color, opacity = 1) {
  if (!color || typeof color !== 'object') return null;
  const channels = rgbaChannels(color);
  const alpha = Math.max(0, Math.min(1, channels.a * (finiteNumber(opacity) ?? 1)));
  if (alpha < 0.9999) {
    return `rgba(${channels.r}, ${channels.g}, ${channels.b}, ${tidyNumber(alpha)})`;
  }
  return `#${[channels.r, channels.g, channels.b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function gradientStopToCss(stop) {
  const color = colorToCss(stop?.color ?? stop, stop?.opacity ?? 1);
  const position = finiteNumber(stop?.position ?? stop?.offset);
  return [color, position === null ? null : `${tidyNumber(position * (position <= 1 ? 100 : 1))}%`]
    .filter(Boolean)
    .join(' ');
}

function fillToCss(fill) {
  if (!fill || fill.visible === false) return null;
  const opacity = fill.opacity ?? 1;
  if (fill.type === 'color' || fill.color) return colorToCss(fill.color ?? fill, opacity);

  const stops = fill.stops ?? fill.gradientStops ?? fill.colors;
  if (Array.isArray(stops) && stops.length > 0) {
    const kind = String(fill.type ?? fill.gradientType ?? '').toLowerCase();
    const prefix = kind.includes('radial') ? 'radial-gradient' : 'linear-gradient';
    const angle = finiteNumber(fill.angle ?? fill.degree);
    const head = prefix === 'linear-gradient' && angle !== null ? `${tidyNumber(angle)}deg, ` : '';
    return `${prefix}(${head}${stops.map(gradientStopToCss).filter(Boolean).join(', ')})`;
  }

  if (fill.type === 'image' || fill.imageHash || fill.hash) {
    return `image:${fill.imageHash ?? fill.hash ?? fill.id ?? 'unknown'}`;
  }
  return null;
}

function resolveLinkedFills(genome, node) {
  if (Array.isArray(node?.fills) && node.fills.length > 0) return node.fills;
  if (!node?.fillLink) return [];
  const linked = (genome?.styles?.fillStyles ?? []).find((style) => style.id === node.fillLink);
  return linked?.data ?? linked?.fills ?? [];
}

function normalizeRadius(radius) {
  if (Array.isArray(radius)) return radius.map((value) => tidyNumber(value));
  if (radius && typeof radius === 'object') {
    const values = [radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft]
      .map((value) => tidyNumber(value));
    return values.some((value) => value !== null) ? values : null;
  }
  return tidyNumber(radius);
}

function extractTypography(node, genome) {
  const segment = node?.textbox?.segments?.[0] ?? {};
  const linkedId = node?.textLink ?? segment.textLink;
  const linked = (genome?.styles?.textStyles ?? []).find((style) => style.id === linkedId);
  const linkedData = linked?.data ?? linked ?? {};
  const source = { ...linkedData, ...segment };
  const fills = source.fills ?? source.fill ? (source.fills ?? [source.fill]) : [];
  const lineHeight = source.lineHeight?.value ?? source.lineHeight;
  const letterSpacing = source.letterSpacing?.value ?? source.letterSpacing;
  const text = node?.textbox?.text ?? node?.characters ?? node?.text ?? null;

  if (!text && Object.keys(source).length === 0) return null;
  return {
    text,
    fontFamily: source.fontName?.family ?? source.fontFamily ?? null,
    fontStyle: source.fontName?.style ?? source.fontStyle ?? null,
    fontSize: tidyNumber(source.fontSize),
    fontWeight: source.fontWeight ?? null,
    lineHeight: tidyNumber(lineHeight),
    letterSpacing: tidyNumber(letterSpacing),
    textAlign: source.textAlign ?? node?.textbox?.align ?? null,
    color: fills.length > 0 ? fillToCss(fills[0]) : null,
  };
}

function extractBorders(node) {
  const strokes = node?.strokes ?? node?.borders ?? [];
  if (!Array.isArray(strokes)) return [];
  return strokes
    .filter((stroke) => stroke?.visible !== false)
    .map((stroke) => ({
      color: fillToCss(stroke),
      width: tidyNumber(stroke.width ?? node?.strokeWidth ?? node?.borderWidth),
      position: stroke.position ?? node?.strokeAlign ?? null,
      style: stroke.style ?? 'solid',
    }));
}

function extractEffects(node) {
  const effects = node?.effects ?? node?.shadows ?? [];
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((effect) => effect?.visible !== false)
    .map((effect) => ({
      type: effect.type ?? 'shadow',
      color: colorToCss(effect.color, effect.opacity ?? 1),
      offsetX: tidyNumber(effect.offset?.x ?? effect.x) ?? 0,
      offsetY: tidyNumber(effect.offset?.y ?? effect.y) ?? 0,
      blur: tidyNumber(effect.radius ?? effect.blur) ?? 0,
      spread: tidyNumber(effect.spread) ?? 0,
    }));
}

function relativeMetrics(node, parent) {
  const rect = getRect(node);
  if (!parent) return { ...rect, relativeX: 0, relativeY: 0 };
  const parentRect = getRect(parent);
  const relativeX = rect.x - parentRect.x;
  const relativeY = rect.y - parentRect.y;
  return {
    ...rect,
    relativeX: tidyNumber(relativeX),
    relativeY: tidyNumber(relativeY),
    right: tidyNumber(parentRect.width - relativeX - rect.width),
    bottom: tidyNumber(parentRect.height - relativeY - rect.height),
  };
}

export function extractNodeStyle(genome, node, parent = null) {
  const fills = resolveLinkedFills(genome, node).filter((fill) => fill?.visible !== false);
  const fillValues = fills.map(fillToCss).filter(Boolean);
  const typography = extractTypography(node, genome);
  const opacity = tidyNumber(node?.blend?.opacity ?? node?.opacity ?? 1);
  const style = {
    layout: relativeMetrics(node, parent),
    fills: fillValues,
    background: node?.type === 'text' ? null : (fillValues[0] ?? null),
    opacity,
    borderRadius: normalizeRadius(node?.borderRadius ?? node?.cornerRadius ?? node?.radii),
    borders: extractBorders(node),
    effects: extractEffects(node),
    typography,
    visible: node?.visible !== false && node?.hidden !== true,
    clipContent: node?.clipContent ?? node?.clipsContent ?? null,
  };
  style.css = styleToCss(style);
  return style;
}

export function styleToCss(style) {
  const css = {};
  const layout = style?.layout ?? {};
  if (layout.width !== null) css.width = `${layout.width}px`;
  if (layout.height !== null) css.height = `${layout.height}px`;
  if (layout.relativeX !== null) css.left = `${layout.relativeX}px`;
  if (layout.relativeY !== null) css.top = `${layout.relativeY}px`;
  css.position = 'absolute';
  if (style?.background && !String(style.background).startsWith('image:')) css.background = style.background;
  if (style?.opacity !== null && style?.opacity !== 1) css.opacity = String(style.opacity);
  const radius = style?.borderRadius;
  if (Array.isArray(radius)) css.borderRadius = radius.map((value) => `${value ?? 0}px`).join(' ');
  else if (radius !== null && radius !== undefined) css.borderRadius = `${radius}px`;
  const border = style?.borders?.[0];
  if (border?.width && border?.color) css.border = `${border.width}px ${border.style ?? 'solid'} ${border.color}`;
  if (style?.effects?.length) {
    css.boxShadow = style.effects
      .filter((effect) => String(effect.type).toLowerCase().includes('shadow'))
      .map((effect) => `${effect.offsetX}px ${effect.offsetY}px ${effect.blur}px ${effect.spread}px ${effect.color ?? 'rgba(0, 0, 0, 0.2)'}`)
      .join(', ') || undefined;
  }
  const text = style?.typography;
  if (text) {
    if (text.color) css.color = text.color;
    if (text.fontFamily) css.fontFamily = text.fontFamily;
    if (text.fontSize !== null) css.fontSize = `${text.fontSize}px`;
    if (text.fontWeight !== null) css.fontWeight = String(text.fontWeight);
    if (text.lineHeight !== null) css.lineHeight = `${text.lineHeight}px`;
    if (text.letterSpacing !== null) css.letterSpacing = `${text.letterSpacing}px`;
    if (text.textAlign) css.textAlign = text.textAlign;
  }
  return Object.fromEntries(Object.entries(css).filter(([, value]) => value !== undefined));
}

export function getGenomePages(genome) {
  if (Array.isArray(genome?.pages)) return genome.pages;
  if (Array.isArray(genome?.document?.children)) return genome.document.children;
  return [];
}

export function findNodeWithParent(genome, targetId) {
  const wanted = String(targetId ?? '');
  const shortId = wanted.split(';').pop();
  let match = null;

  function visit(node, parent) {
    if (!node || match) return;
    const id = String(node.id ?? node.nodeId ?? '');
    if (id === wanted || id === shortId || id.endsWith(shortId) || wanted.endsWith(id)) {
      match = { node, parent };
      return;
    }
    for (const child of node.children ?? []) visit(child, node);
  }
  for (const page of getGenomePages(genome)) visit(page, null);
  return match;
}

export function flattenGenome(genome, options = {}) {
  const frameId = options.frameId ? String(options.frameId) : null;
  const maxNodes = Math.min(Math.max(Number(options.maxNodes ?? DEFAULT_MAX_NODES), 1), 20_000);
  const includeHidden = Boolean(options.includeHidden);
  const rows = [];

  function visit(node, parent, depth) {
    if (!node || rows.length >= maxNodes) return;
    const style = extractNodeStyle(genome, node, parent);
    if (includeHidden || style.visible) {
      rows.push({
        id: String(node.id ?? ''),
        name: String(node.name ?? ''),
        type: String(node.type ?? ''),
        depth,
        ...style.layout,
      });
    }
    for (const child of node.children ?? []) visit(child, node, depth + 1);
  }

  for (const page of getGenomePages(genome)) {
    if (frameId && String(page.id) !== frameId) continue;
    visit(page, null, 0);
  }
  return { nodes: rows, truncated: rows.length >= maxNodes, maxNodes };
}

export function buildTree(genome, options = {}) {
  const frameId = options.frameId ? String(options.frameId) : null;
  const maxDepth = Math.min(Math.max(Number(options.maxDepth ?? 8), 0), 99);
  const maxNodes = Math.min(Math.max(Number(options.maxNodes ?? DEFAULT_MAX_NODES), 1), 20_000);
  const withStyle = options.withStyle !== false;
  const includeHidden = Boolean(options.includeHidden);
  let count = 0;
  let truncated = false;

  function convert(node, parent, depth) {
    if (!node || count >= maxNodes) {
      truncated = true;
      return null;
    }
    const style = extractNodeStyle(genome, node, parent);
    if (!includeHidden && !style.visible) return null;
    count += 1;
    const output = {
      id: String(node.id ?? ''),
      name: String(node.name ?? ''),
      type: String(node.type ?? ''),
      ...style.layout,
    };
    if (style.typography?.text) output.text = style.typography.text;
    if (withStyle) output.style = style;
    if (depth < maxDepth && Array.isArray(node.children)) {
      const children = node.children.map((child) => convert(child, node, depth + 1)).filter(Boolean);
      if (children.length) output.children = children;
    } else if (Array.isArray(node.children) && node.children.length > 0) {
      output.childCount = node.children.length;
    }
    return output;
  }

  const tree = getGenomePages(genome)
    .filter((page) => !frameId || String(page.id) === frameId)
    .map((page) => convert(page, null, 0))
    .filter(Boolean);
  return { tree, nodeCount: count, truncated, maxDepth, maxNodes };
}

function collectSpacing(node, parent, values) {
  const children = (node.children ?? []).filter((child) => child?.visible !== false && child?.hidden !== true);
  if (children.length > 0) {
    const parentRect = getRect(node);
    const childRects = children.map(getRect);
    const left = Math.min(...childRects.map((rect) => rect.x)) - parentRect.x;
    const top = Math.min(...childRects.map((rect) => rect.y)) - parentRect.y;
    const right = parentRect.x + parentRect.width - Math.max(...childRects.map((rect) => rect.x + rect.width));
    const bottom = parentRect.y + parentRect.height - Math.max(...childRects.map((rect) => rect.y + rect.height));
    for (const value of [left, top, right, bottom]) if (value > 0) values.push(tidyNumber(value));

    const horizontal = [...childRects].sort((a, b) => a.x - b.x);
    const vertical = [...childRects].sort((a, b) => a.y - b.y);
    for (let index = 1; index < horizontal.length; index += 1) {
      const gap = horizontal[index].x - (horizontal[index - 1].x + horizontal[index - 1].width);
      if (gap > 0) values.push(tidyNumber(gap));
    }
    for (let index = 1; index < vertical.length; index += 1) {
      const gap = vertical[index].y - (vertical[index - 1].y + vertical[index - 1].height);
      if (gap > 0) values.push(tidyNumber(gap));
    }
  }
  for (const child of children) collectSpacing(child, node, values);
}

export function extractTokens(genome) {
  const colors = [];
  const gradients = [];
  const fontFamilies = [];
  const fontSizes = [];
  const fontWeights = [];
  const lineHeights = [];
  const letterSpacings = [];
  const radii = [];
  const spacing = [];
  const shadows = [];

  function visit(node) {
    const style = extractNodeStyle(genome, node, null);
    for (const fill of style.fills) {
      if (String(fill).includes('gradient(')) gradients.push(fill);
      else if (!String(fill).startsWith('image:')) colors.push(fill);
    }
    for (const border of style.borders) if (border.color) colors.push(border.color);
    const typography = style.typography;
    if (typography) {
      if (typography.color) colors.push(typography.color);
      if (typography.fontFamily) fontFamilies.push(typography.fontFamily);
      if (typography.fontSize !== null) fontSizes.push(typography.fontSize);
      if (typography.fontWeight !== null) fontWeights.push(String(typography.fontWeight));
      if (typography.lineHeight !== null) lineHeights.push(typography.lineHeight);
      if (typography.letterSpacing !== null) letterSpacings.push(typography.letterSpacing);
    }
    if (Array.isArray(style.borderRadius)) radii.push(...style.borderRadius.filter((value) => value !== null));
    else if (style.borderRadius !== null) radii.push(style.borderRadius);
    for (const effect of style.effects) {
      if (String(effect.type).toLowerCase().includes('shadow')) shadows.push(JSON.stringify(effect));
    }
    for (const child of node.children ?? []) visit(child);
  }

  for (const page of getGenomePages(genome)) {
    visit(page);
    collectSpacing(page, null, spacing);
  }
  return {
    colors: uniqueSortedStrings(colors),
    gradients: uniqueSortedStrings(gradients),
    fontFamilies: uniqueSortedStrings(fontFamilies),
    fontSizes: uniqueSortedNumbers(fontSizes),
    fontWeights: uniqueSortedStrings(fontWeights),
    lineHeights: uniqueSortedNumbers(lineHeights),
    letterSpacings: uniqueSortedNumbers(letterSpacings),
    radii: uniqueSortedNumbers(radii),
    spacing: uniqueSortedNumbers(spacing),
    shadows: uniqueSortedStrings(shadows).map((value) => JSON.parse(value)),
  };
}

export function extractDesignMeta(genome, nodeMeta = {}) {
  const frames = getGenomePages(genome).map((page) => {
    const rect = getRect(page);
    return {
      id: String(page.id ?? ''),
      name: String(page.name ?? 'Untitled'),
      width: rect.width,
      height: rect.height,
      childCount: Array.isArray(page.children) ? page.children.length : 0,
    };
  });
  return {
    id: String(nodeMeta.id ?? nodeMeta.nodeId ?? ''),
    title: String(nodeMeta.name ?? frames[0]?.name ?? 'Untitled'),
    genomeVersion: genome?.genomeVer ?? genome?.version ?? null,
    frameCount: frames.length,
    frames,
    preview: nodeMeta?.preview?.large ?? nodeMeta?.preview?.normal ?? null,
    updatedAt: nodeMeta.updatedAt ?? nodeMeta.updateTime ?? null,
  };
}
