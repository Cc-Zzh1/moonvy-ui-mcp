const DEFAULT_MAX_NODES = 2_000;
const DEFAULT_RPX_BASE_WIDTH = 750;

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

function containsNode(root, target) {
  if (!root || !target) return false;
  if (root === target || String(root.id ?? '') === String(target.id ?? '')) return true;
  return (root.children ?? []).some((child) => containsNode(child, target));
}

function containingPage(genome, node) {
  const pages = getGenomePages(genome);
  if (!node) return pages[0] ?? null;
  return pages.find((page) => containsNode(page, node)) ?? pages[0] ?? null;
}

export function inferDesignUnits(genome, node = null) {
  const configuredUnit = String(process.env.MOONVY_CSS_UNIT ?? 'auto').trim().toLowerCase();
  const page = containingPage(genome, node);
  const frameWidth = getRect(page).width;
  const configuredBase = finiteNumber(process.env.MOONVY_RPX_BASE_WIDTH);
  const rpxBaseWidth = configuredBase && configuredBase > 0 ? configuredBase : DEFAULT_RPX_BASE_WIDTH;
  const cssUnit = configuredUnit === 'px'
    ? 'px'
    : configuredUnit === 'rpx' || (configuredUnit === 'auto' && frameWidth > 0 && frameWidth <= rpxBaseWidth)
      ? 'rpx'
      : 'px';
  const configuredScale = finiteNumber(process.env.MOONVY_RPX_SCALE);
  const scale = cssUnit === 'rpx'
    ? configuredScale && configuredScale > 0
      ? configuredScale
      : frameWidth > 0
        ? rpxBaseWidth / frameWidth
        : 2
    : 1;
  return {
    sourceUnit: 'px',
    cssUnit,
    scale: tidyNumber(scale),
    relation: `1px = ${tidyNumber(scale)}${cssUnit}`,
    strategy: configuredUnit === 'auto' ? 'auto-from-artboard-width' : 'configured',
    artboardWidth: frameWidth || null,
    rpxBaseWidth: cssUnit === 'rpx' ? rpxBaseWidth : null,
  };
}

function cssNumber(value, units) {
  const number = finiteNumber(value);
  return number === null ? null : tidyNumber(number * (units?.scale ?? 1));
}

function cssLength(value, units) {
  const number = cssNumber(value, units);
  return number === null ? null : `${number}${units?.cssUnit ?? 'px'}`;
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
    a: Math.max(0, Math.min(1, finiteNumber(color.a ?? color.alpha) ?? 1)),
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

function gradientStopToCss(stop, fillOpacity = 1, cssPosition = undefined) {
  const color = colorToCss(stop?.color ?? stop, (finiteNumber(stop?.opacity) ?? 1) * (finiteNumber(fillOpacity) ?? 1));
  const rawPosition = stop?.position ?? stop?.offset;
  const position = cssPosition === undefined
    ? rawPosition == null ? null : finiteNumber(rawPosition)
    : cssPosition;
  return [color, position === null ? null : `${tidyNumber(cssPosition === undefined ? position * (position <= 1 ? 100 : 1) : position, 2)}%`]
    .filter(Boolean)
    .join(' ');
}

function gradientPoint(point) {
  if (point?.x == null || point?.y == null) return null;
  const x = finiteNumber(point.x);
  const y = finiteNumber(point.y);
  return x === null || y === null ? null : { x, y };
}

// Moonvy's CSS encoder projects normalized handles onto the CSS gradient line
// of a unit square, not the node's pixel-sized rectangle.
function linearGradientGeometry(gradient) {
  if (gradient.onlyAngle) return null;
  const from = gradientPoint(gradient.from);
  const to = gradientPoint(gradient.to);
  const aspect = gradientPoint(gradient.aspect);
  if (!from || !to || !aspect) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const cross = dx * (aspect.y - from.y) - dy * (aspect.x - from.x);
  if (distance < 1e-10 || Math.abs(cross) < 1e-10) return null;
  let angle = Math.atan2(from.y - aspect.y, from.x - aspect.x) * 180 / Math.PI;
  if (cross > 0) angle -= 180;
  angle = (angle + 360) % 360;
  const radians = angle * Math.PI / 180;
  const direction = { x: Math.sin(radians), y: -Math.cos(radians) };
  const length = Math.abs(direction.x) + Math.abs(direction.y);
  const start = { x: 0.5 - direction.x * length / 2, y: 0.5 - direction.y * length / 2 };
  const offset = ((from.x - start.x) * direction.x + (from.y - start.y) * direction.y) / length;
  return { angle: tidyNumber(angle, 2), offset, scale: distance / length };
}

function fillToCss(fill) {
  if (!fill || fill.visible === false) return null;
  const opacity = fill.opacity ?? 1;
  const gradient = fill.gradient ?? fill;
  const stops = gradient.stops ?? gradient.gradientStops ?? gradient.colors;
  if (Array.isArray(stops) && stops.length > 0) {
    const kind = String(gradient.type ?? fill.gradientType ?? fill.type ?? '').toLowerCase();
    const prefix = kind.includes('radial') ? 'radial-gradient' : 'linear-gradient';
    const angle = finiteNumber(gradient.angle ?? gradient.degree ?? fill.angle ?? fill.degree);
    const geometry = prefix === 'linear-gradient' ? linearGradientGeometry(gradient) : null;
    const cssAngle = geometry?.angle ?? angle;
    let head = prefix === 'linear-gradient' && cssAngle !== null ? `${tidyNumber(cssAngle, 2)}deg, ` : '';
    if (prefix === 'radial-gradient') {
      const from = gradientPoint(gradient.from);
      const to = gradientPoint(gradient.to);
      const aspect = gradientPoint(gradient.aspect);
      if (from) {
        let size = 'circle';
        if (to && aspect) {
          const points = [from, to, aspect];
          const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
          const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
          size = `${tidyNumber(width * 100, 2)}% ${tidyNumber(height * 100, 2)}%`;
        }
        head = `${size} at ${tidyNumber(from.x * 100, 2)}% ${tidyNumber(from.y * 100, 2)}%, `;
      }
    }
    const cssStops = stops.map((stop) => {
      const rawPosition = stop?.position ?? stop?.offset;
      const position = rawPosition == null ? null : finiteNumber(rawPosition);
      // Native Genome stops are ratios, including values outside [0, 1].
      const cssPosition = position === null ? null : geometry
        ? (position * geometry.scale + geometry.offset) * 100
        : fill.gradient ? position * 100 : undefined;
      return gradientStopToCss(stop, opacity, cssPosition);
    });
    return `${prefix}(${head}${cssStops.filter(Boolean).join(', ')})`;
  }

  if (fill.type === 'color' || fill.color) return colorToCss(fill.color ?? fill, opacity);

  if (fill.type === 'image' || fill.imageHash || fill.hash) {
    return `image:${fill.imageHash ?? fill.hash ?? fill.id ?? 'unknown'}`;
  }
  return null;
}

function normalizeFillDetail(fill) {
  const css = fillToCss(fill);
  const gradient = fill?.gradient ?? fill;
  const stops = gradient?.stops ?? gradient?.gradientStops ?? gradient?.colors;
  if (Array.isArray(stops) && stops.length > 0) {
    return {
      type: String(gradient.type ?? fill.type ?? 'gradient'),
      opacity: tidyNumber(fill.opacity ?? 1),
      css,
      gradient: {
        type: String(gradient.type ?? fill.gradientType ?? 'linear'),
        stops: stops.map((stop) => ({
          color: colorToCss(stop?.color ?? stop, (finiteNumber(stop?.opacity) ?? 1) * (finiteNumber(fill.opacity) ?? 1)),
          position: tidyNumber(stop?.position ?? stop?.offset),
        })),
        from: gradient.from ?? null,
        to: gradient.to ?? null,
        aspect: gradient.aspect ?? null,
        angle: tidyNumber(gradient.angle ?? gradient.degree),
        onlyAngle: gradient.onlyAngle ?? null,
      },
    };
  }
  if (fill?.type === 'image' || fill?.imageHash || fill?.hash) {
    return { type: 'image', opacity: tidyNumber(fill.opacity ?? 1), css, imageHash: fill.imageHash ?? fill.hash ?? fill.id ?? null };
  }
  return { type: String(fill?.type ?? 'color'), opacity: tidyNumber(fill?.opacity ?? 1), css };
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

function normalizeLineHeight(raw) {
  const rawUnit = typeof raw === 'object' && raw !== null ? raw.unit : null;
  const value = typeof raw === 'object' && raw !== null ? raw.value : raw;
  if (value === 'auto' || value === 'normal' || rawUnit === 'auto') return { value: null, unit: 'auto' };
  if (value == null || value === '') return { value: null, unit: null };
  const number = tidyNumber(value);
  if (number === null) return { value: null, unit: null };
  const unit = String(rawUnit ?? 'px').toLowerCase();
  return {
    value: number,
    unit: ['per', 'percent', 'percentage', '%'].includes(unit) ? '%'
      : ['pixel', 'pixels', 'px'].includes(unit) ? 'px' : unit,
  };
}

function lineHeightToCss(text, units) {
  if (text.lineHeightUnit === 'auto') return 'normal';
  if (text.lineHeight == null) return undefined;
  if (text.lineHeightUnit === '%') return `${text.lineHeight}%`;
  if (text.lineHeightUnit === 'number') return String(text.lineHeight);
  if (text.lineHeightUnit == null || text.lineHeightUnit === 'px') return cssLength(text.lineHeight, units);
  return undefined;
}

function extractTypography(node, genome) {
  const segment = node?.textbox?.segments?.[0] ?? {};
  const linkedId = node?.textLink ?? segment.textLink;
  const linked = (genome?.styles?.textStyles ?? []).find((style) => style.id === linkedId);
  const linkedData = linked?.data ?? linked ?? {};
  const source = { ...linkedData, ...segment };
  const fills = source.fills ?? source.fill ? (source.fills ?? [source.fill]) : [];
  const lineHeight = normalizeLineHeight(source.lineHeight);
  const letterSpacing = source.letterSpacing?.value ?? source.letterSpacing;
  const text = node?.textbox?.text ?? node?.characters ?? node?.text ?? null;

  if (!text && Object.keys(source).length === 0) return null;
  return {
    text,
    fontFamily: source.fontName?.family ?? source.fontFamily ?? null,
    fontStyle: source.fontName?.style ?? source.fontStyle ?? null,
    fontSize: tidyNumber(source.fontSize),
    fontWeight: source.fontWeight ?? null,
    lineHeight: lineHeight.value,
    lineHeightUnit: lineHeight.unit,
    letterSpacing: tidyNumber(letterSpacing),
    textAlign: source.textAlign ?? node?.textbox?.align ?? null,
    color: fills.length > 0 ? fillToCss(fills[0]) : null,
  };
}

function extractBorders(node, units) {
  const strokes = node?.strokes ?? node?.borders ?? [];
  if (!Array.isArray(strokes)) return [];
  return strokes
    .filter((stroke) => stroke?.visible !== false)
    .map((stroke) => {
      const strokeFill = (stroke.fills ?? []).find((fill) => fill?.visible !== false) ?? stroke.fill ?? stroke;
      const width = tidyNumber(stroke.w ?? stroke.width ?? node?.strokeWidth ?? node?.borderWidth);
      const color = fillToCss(strokeFill);
      const style = stroke.style ?? (Array.isArray(stroke.dash) && stroke.dash.length > 0 ? 'dashed' : 'solid');
      const cssWidth = cssNumber(width, units);
      return {
        color,
        width,
        unit: units.sourceUnit,
        cssWidth,
        cssUnit: units.cssUnit,
        position: stroke.align ?? stroke.position ?? node?.strokeAlign ?? null,
        style,
        css: cssWidth !== null && color ? `${cssWidth}${units.cssUnit} ${style} ${color}` : null,
      };
    });
}

function extractEffects(node, units) {
  const effects = node?.effects ?? node?.shadows ?? [];
  if (!Array.isArray(effects)) return [];
  return effects
    .filter((effect) => effect?.visible !== false)
    .map((effect) => {
      const color = colorToCss(effect.color, effect.opacity ?? 1);
      const offsetX = tidyNumber(effect.offset?.x ?? effect.offsetX ?? effect.x) ?? 0;
      const offsetY = tidyNumber(effect.offset?.y ?? effect.offsetY ?? effect.y) ?? 0;
      const blur = tidyNumber(effect.radius ?? effect.blur) ?? 0;
      const spread = tidyNumber(effect.spread) ?? 0;
      return {
        type: effect.type ?? 'shadow',
        color,
        offsetX,
        offsetY,
        blur,
        spread,
        unit: units.sourceUnit,
        cssUnit: units.cssUnit,
        cssScale: units.scale,
        css: [offsetX, offsetY, blur, spread]
          .map((value) => cssLength(value, units))
          .concat(color ?? 'rgba(0, 0, 0, 0.2)')
          .join(' '),
      };
    });
}

function relativeMetrics(node, parent) {
  const rect = getRect(node);
  if (!parent) return { ...rect, relativeX: 0, relativeY: 0, coordinateSpace: 'canvas', unit: 'px' };
  const parentRect = getRect(parent);
  const subtractedX = rect.x - parentRect.x;
  const subtractedY = rect.y - parentRect.y;
  const tolerance = 0.01;
  const localFits = rect.x >= -tolerance
    && rect.y >= -tolerance
    && rect.x + rect.width <= parentRect.width + tolerance
    && rect.y + rect.height <= parentRect.height + tolerance;
  const subtractedFits = subtractedX >= -tolerance
    && subtractedY >= -tolerance
    && subtractedX + rect.width <= parentRect.width + tolerance
    && subtractedY + rect.height <= parentRect.height + tolerance;
  const parentStartsLocalSpace = String(parent?.type ?? '').toLowerCase() === 'artboard' || parent?.isFrame === true;
  const useLocalRect = parentStartsLocalSpace || (localFits && !subtractedFits);
  const relativeX = useLocalRect ? rect.x : subtractedX;
  const relativeY = useLocalRect ? rect.y : subtractedY;
  return {
    ...rect,
    relativeX: tidyNumber(relativeX),
    relativeY: tidyNumber(relativeY),
    right: tidyNumber(parentRect.width - relativeX - rect.width),
    bottom: tidyNumber(parentRect.height - relativeY - rect.height),
    coordinateSpace: useLocalRect ? 'parent' : 'canvas',
    unit: 'px',
  };
}

export function extractNodeStyle(genome, node, parent = null) {
  const fills = resolveLinkedFills(genome, node).filter((fill) => fill?.visible !== false);
  const fillValues = fills.map(fillToCss).filter(Boolean);
  const fillDetails = fills.map(normalizeFillDetail).filter((fill) => fill.css);
  const typography = extractTypography(node, genome);
  const opacity = tidyNumber(node?.blend?.opacity ?? node?.opacity ?? 1);
  const units = inferDesignUnits(genome, node);
  const style = {
    units,
    layout: relativeMetrics(node, parent),
    fills: fillValues,
    fillDetails,
    background: node?.type === 'text' ? null : (fillValues[0] ?? null),
    opacity,
    borderRadius: normalizeRadius(node?.borderRadius ?? node?.cornerRadius ?? node?.radii),
    borders: extractBorders(node, units),
    effects: extractEffects(node, units),
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
  const units = style?.units ?? { cssUnit: 'px', scale: 1 };
  if (layout.width !== null) css.width = cssLength(layout.width, units);
  if (layout.height !== null) css.height = cssLength(layout.height, units);
  if (layout.relativeX !== null) css.left = cssLength(layout.relativeX, units);
  if (layout.relativeY !== null) css.top = cssLength(layout.relativeY, units);
  css.position = 'absolute';
  if (style?.background && !String(style.background).startsWith('image:')) css.background = style.background;
  if (style?.opacity !== null && style?.opacity !== 1) css.opacity = String(style.opacity);
  const radius = style?.borderRadius;
  if (Array.isArray(radius)) css.borderRadius = radius.map((value) => cssLength(value ?? 0, units)).join(' ');
  else if (radius !== null && radius !== undefined) css.borderRadius = cssLength(radius, units);
  const border = style?.borders?.[0];
  if (border?.css) {
    css.border = border.css;
    if (border.position === 'inside') css.boxSizing = 'border-box';
  }
  if (style?.effects?.length) {
    css.boxShadow = style.effects
      .filter((effect) => String(effect.type).toLowerCase().includes('shadow'))
      .map((effect) => effect.css)
      .join(', ') || undefined;
  }
  const text = style?.typography;
  if (text) {
    if (text.color) css.color = text.color;
    if (text.fontFamily) css.fontFamily = text.fontFamily;
    if (text.fontSize !== null) css.fontSize = cssLength(text.fontSize, units);
    if (text.fontWeight !== null) css.fontWeight = String(text.fontWeight);
    css.lineHeight = lineHeightToCss(text, units);
    if (text.letterSpacing !== null) css.letterSpacing = cssLength(text.letterSpacing, units);
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
    const childRects = children.map((child) => {
      const layout = relativeMetrics(child, node);
      return { x: layout.relativeX, y: layout.relativeY, width: layout.width, height: layout.height };
    });
    const left = Math.min(...childRects.map((rect) => rect.x));
    const top = Math.min(...childRects.map((rect) => rect.y));
    const right = parentRect.width - Math.max(...childRects.map((rect) => rect.x + rect.width));
    const bottom = parentRect.height - Math.max(...childRects.map((rect) => rect.y + rect.height));
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
  const lineHeightDetails = [];
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
      if (typography.lineHeightUnit !== null) lineHeightDetails.push(JSON.stringify({
        value: typography.lineHeight,
        unit: typography.lineHeightUnit,
        css: style.css.lineHeight ?? null,
      }));
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
    units: inferDesignUnits(genome),
    colors: uniqueSortedStrings(colors),
    gradients: uniqueSortedStrings(gradients),
    fontFamilies: uniqueSortedStrings(fontFamilies),
    fontSizes: uniqueSortedNumbers(fontSizes),
    fontWeights: uniqueSortedStrings(fontWeights),
    lineHeights: uniqueSortedNumbers(lineHeights),
    lineHeightDetails: uniqueSortedStrings(lineHeightDetails).map((value) => JSON.parse(value)),
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
    units: inferDesignUnits(genome),
    preview: nodeMeta?.preview?.large ?? nodeMeta?.preview?.normal ?? null,
    updatedAt: nodeMeta.updatedAt
      ?? nodeMeta.updated_at
      ?? nodeMeta.updateTime
      ?? nodeMeta._updateDate
      ?? nodeMeta.modifDate
      ?? nodeMeta.meta?.uploadDate
      ?? nodeMeta.mtime
      ?? null,
    version: {
      id: nodeMeta.versionId ?? null,
      number: nodeMeta.versionLastNo ?? null,
      count: nodeMeta.versionLen ?? null,
    },
  };
}
