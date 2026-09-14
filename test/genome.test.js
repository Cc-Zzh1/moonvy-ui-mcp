import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTree,
  colorToCss,
  extractDesignMeta,
  extractNodeStyle,
  extractTokens,
  findNodeWithParent,
  flattenGenome,
  styleToCss,
} from '../src/genome.js';
import { normalizeToken, parseMoonvyUrl } from '../src/moonvy-client.js';

const genome = {
  genomeVer: 12,
  pages: [
    {
      id: '1:1',
      name: '新增学生',
      type: 'frame',
      rect: { x: 0, y: 0, w: 375, h: 812 },
      fills: [{ type: 'color', color: { r: 255, g: 255, b: 255 } }],
      children: [
        {
          id: '1:2',
          name: '学生卡片',
          type: 'rect',
          rect: { x: 16, y: 100, w: 343, h: 200 },
          fills: [{ type: 'color', color: { r: 247, g: 248, b: 250 } }],
          borderRadius: 12,
          effects: [{ type: 'dropShadow', color: { r: 0, g: 0, b: 0 }, opacity: 0.08, offset: { x: 0, y: 4 }, blur: 12 }],
          children: [
            {
              id: '1:3',
              name: '标题',
              type: 'text',
              rect: { x: 32, y: 120, w: 100, h: 24 },
              textbox: {
                text: '新增学生',
                segments: [{
                  fontName: { family: 'PingFang SC', style: 'Semibold' },
                  fontSize: 18,
                  fontWeight: 600,
                  lineHeight: { value: 24 },
                  letterSpacing: { value: 0 },
                  fills: [{ type: 'color', color: { r: 31, g: 35, b: 41 } }],
                }],
              },
            },
            {
              id: '1:4',
              name: '确认按钮',
              type: 'rect',
              rect: { x: 32, y: 160, w: 120, h: 40 },
              fills: [{ type: 'color', color: { r: 22, g: 119, b: 255 } }],
              borderRadius: 8,
            },
          ],
        },
      ],
    },
  ],
};

test('parseMoonvyUrl extracts project, directory, and file IDs', () => {
  assert.deepEqual(
    parseMoonvyUrl('https://moonvy.com/project/project-id/dir-id/file-id?ignored=1'),
    {
      projectId: 'project-id',
      dirId: 'dir-id',
      fileId: 'file-id',
      cleanUrl: 'https://moonvy.com/project/project-id/dir-id/file-id',
    },
  );
});

test('parseMoonvyUrl rejects another host', () => {
  assert.throws(() => parseMoonvyUrl('https://example.com/project/a/b/c'), /moonvy\.com/);
});

test('Moonvy token accepts either a raw JWT or a Bearer-prefixed JWT', () => {
  assert.equal(normalizeToken('abc.def.ghi'), 'abc.def.ghi');
  assert.equal(normalizeToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(normalizeToken('  bearer   abc.def.ghi  '), 'abc.def.ghi');
});

test('colors support both 0-255 and normalized channels', () => {
  assert.equal(colorToCss({ r: 22, g: 119, b: 255 }), '#1677ff');
  assert.equal(colorToCss({ r: 1, g: 0, b: 0 }, 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.equal(colorToCss({ r: 158, g: 122, b: 212, alpha: 0.1 }), 'rgba(158, 122, 212, 0.1)');
});

test('node style includes parent-relative metrics and CSS', () => {
  const found = findNodeWithParent(genome, '1:4');
  assert.ok(found);
  const style = extractNodeStyle(genome, found.node, found.parent);
  assert.equal(style.layout.relativeX, 16);
  assert.equal(style.layout.relativeY, 60);
  assert.equal(style.layout.right, 207);
  assert.equal(style.background, '#1677ff');
  assert.equal(style.borderRadius, 8);
  assert.equal(style.css.background, '#1677ff');
  assert.equal(style.units.relation, '1px = 2rpx');
  assert.equal(style.css.width, '240rpx');
});

test('Moonvy native gradient, stroke, shadow, artboard coordinates, and version fields are normalized', () => {
  const actualGenome = {
    genomeVer: 12,
    pages: [{
      id: '1462:20496',
      name: '学生档案-详情',
      type: 'artboard',
      isFrame: true,
      rect: { x: 23343, y: 935, w: 375, h: 812 },
      children: [{
        id: '1462:20618',
        name: 'Rectangle 78',
        type: 'layer',
        rect: { x: 16, y: 268, w: 343, h: 64 },
        borderRadius: 8,
        fills: [{
          type: 'gradient',
          opacity: 1,
          gradient: {
            type: 'radial',
            from: { x: 0.025333, y: 0.023305 },
            to: { x: 0.972, y: 1 },
            aspect: { x: -0.951362, y: 0.620857 },
            angle: 0,
            stops: [
              { color: { r: 243.636223, g: 236.572266, b: 255, alpha: 1 }, position: 0 },
              { color: { r: 222.512017, g: 241.463333, b: 255, alpha: 1 }, position: 0.804463 },
              { color: { r: 255, g: 255, b: 255, alpha: 1 }, position: 1 },
            ],
          },
        }],
        strokes: [{
          fills: [{ type: 'color', color: { r: 255, g: 255, b: 255 } }],
          w: 1,
          align: 'inside',
          dash: [],
        }],
        effects: [{
          type: 'shadow',
          offsetX: 0,
          offsetY: 4,
          blur: 5.8,
          spread: 0,
          color: { r: 158.187169, g: 122.059513, b: 212.378675, alpha: 0.1 },
        }],
      }],
    }],
  };
  const found = findNodeWithParent(actualGenome, '1462:20618');
  const style = extractNodeStyle(actualGenome, found.node, found.parent);

  assert.equal(style.layout.relativeX, 16);
  assert.equal(style.layout.relativeY, 268);
  assert.equal(style.layout.right, 16);
  assert.equal(style.layout.bottom, 480);
  assert.equal(style.layout.coordinateSpace, 'parent');
  assert.equal(style.background, 'radial-gradient(192.34% 97.67% at 2.53% 2.33%, #f4edff 0%, #dff1ff 80.45%, #ffffff 100%)');
  assert.equal(style.fillDetails[0].gradient.type, 'radial');
  assert.equal(style.borders[0].width, 1);
  assert.equal(style.borders[0].css, '2rpx solid #ffffff');
  assert.deepEqual(
    {
      offsetX: style.effects[0].offsetX,
      offsetY: style.effects[0].offsetY,
      blur: style.effects[0].blur,
      spread: style.effects[0].spread,
      color: style.effects[0].color,
      unit: style.effects[0].unit,
    },
    { offsetX: 0, offsetY: 4, blur: 5.8, spread: 0, color: 'rgba(158, 122, 212, 0.1)', unit: 'px' },
  );
  assert.equal(style.effects[0].css, '0rpx 8rpx 11.6rpx 0rpx rgba(158, 122, 212, 0.1)');
  assert.equal(style.css.boxShadow, '0rpx 8rpx 11.6rpx 0rpx rgba(158, 122, 212, 0.1)');
  assert.equal(style.css.border, '2rpx solid #ffffff');
  assert.equal(style.css.boxSizing, 'border-box');
  assert.equal(style.css.left, '32rpx');
  assert.equal(style.css.top, '536rpx');

  const tokens = extractTokens(actualGenome);
  assert.equal(tokens.units.relation, '1px = 2rpx');
  assert.ok(tokens.gradients.includes(style.background));
  assert.equal(tokens.shadows[0].css, style.effects[0].css);

  const meta = extractDesignMeta(actualGenome, {
    id: 'file-1',
    name: '学生档案',
    _updateDate: '2026-09-01T02:55:08.483Z',
    versionId: 'version-1',
    versionLastNo: 7,
    versionLen: 9,
  });
  assert.equal(meta.updatedAt, '2026-09-01T02:55:08.483Z');
  assert.deepEqual(meta.version, { id: 'version-1', number: 7, count: 9 });
});

function styleForNode(node) {
  const frame = { id: 'frame', type: 'artboard', rect: { x: 0, y: 0, w: 375, h: 812 }, children: [node] };
  const design = { pages: [frame] };
  return { design, style: extractNodeStyle(design, node, frame) };
}

const buttonGradient = {
  type: 'linear', angle: 0, onlyAngle: false,
  from: { x: -3.3208574223841936e-9, y: 0.10294120125120099 },
  to: { x: 0.9999999928974556, y: 0.9411763657834493 },
  aspect: { x: -0.41911758558698176, y: 4.089100575793854 },
  stops: [
    { position: 0, color: { r: 56, g: 213, b: 241 } },
    { position: 1, color: { r: 148, g: 148, b: 255 } },
  ],
};

function gradientStyle(gradient, extra = {}) {
  return styleForNode({ id: 'gradient', rect: { x: 0, y: 0, w: 112, h: 34 }, fills: [{ type: 'gradient', gradient, ...extra }] });
}

test('native linear handles match Moonvy CSS and are consistent across tree and tokens', () => {
  const { style, design } = gradientStyle(buttonGradient);
  const expected = 'linear-gradient(96deg, #38d5f1 0.98%, #9494ff 119.7%)';
  assert.equal(style.background, expected);
  assert.equal(style.fillDetails[0].css, expected);
  assert.equal(style.fillDetails[0].gradient.angle, 0); // Original data is retained.
  assert.equal(style.fillDetails[0].gradient.onlyAngle, false);
  assert.deepEqual(extractTokens(design).gradients, [expected]);
  assert.deepEqual(buildTree(design).tree[0].children[0].style, style);
});

test('onlyAngle and out-of-range native stop ratios retain their semantics', () => {
  const gradient = { ...buttonGradient, onlyAngle: true, angle: 45,
    stops: buttonGradient.stops.map((s, index) => ({ ...s, position: index ? 1.2 : -0.2 })) };
  assert.equal(gradientStyle(gradient).style.background, 'linear-gradient(45deg, #38d5f1 -20%, #9494ff 120%)');
  assert.equal(gradientStyle(gradient, { opacity: 0.5 }).style.background,
    'linear-gradient(45deg, rgba(56, 213, 241, 0.5) -20%, rgba(148, 148, 255, 0.5) 120%)');
});

test('linear handle direction and stop projection work on every axis', () => {
  const cases = [
    [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }, 90],
    [{ x: 1, y: 0.5 }, { x: 0, y: 0.5 }, { x: 1, y: 0 }, 270],
    [{ x: 0.5, y: 1 }, { x: 0.5, y: 0 }, { x: 1, y: 1 }, 0],
    [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 0 }, 180],
  ];
  for (const [from, to, aspect, angle] of cases) {
    assert.equal(gradientStyle({ ...buttonGradient, from, to, aspect }).style.background,
      `linear-gradient(${angle}deg, #38d5f1 0%, #9494ff 100%)`);
  }
});

test('incomplete or degenerate gradient handles have a finite angle fallback', () => {
  for (const extra of [{ aspect: null }, { from: {} }, { to: buttonGradient.from }, { aspect: buttonGradient.from }]) {
    assert.equal(gradientStyle({ ...buttonGradient, angle: 37, ...extra }).style.background,
      'linear-gradient(37deg, #38d5f1 0%, #9494ff 100%)');
  }
  assert.equal(gradientStyle({ ...buttonGradient, type: 'radial', aspect: null }).style.background,
    'radial-gradient(circle at 0% 10.29%, #38d5f1 0%, #9494ff 100%)');
});

test('percentage, pixel, automatic and missing line heights are distinct', () => {
  const cases = [
    [{ value: 150, unit: 'per' }, 150, '%', '150%'],
    [{ value: 150, unit: '%' }, 150, '%', '150%'],
    [{ value: 200, unit: 'per' }, 200, '%', '200%'],
    [{ value: 24, unit: 'px' }, 24, 'px', '48rpx'],
    [{ value: 24 }, 24, 'px', '48rpx'],
    [24, 24, 'px', '48rpx'],
    [{ value: 0, unit: 'px' }, 0, 'px', '0rpx'],
    ['auto', null, 'auto', 'normal'],
    [null, null, null, undefined],
    [undefined, null, null, undefined],
  ];
  for (const [lineHeight, value, unit, css] of cases) {
    const { style, design } = styleForNode({ id: 'text', type: 'text', textbox: {
      text: '王三', segments: [{ fontSize: 16, lineHeight }],
    } });
    assert.equal(style.typography.lineHeight, value);
    assert.equal(style.typography.lineHeightUnit, unit);
    assert.equal(style.css.lineHeight, css);
    assert.deepEqual(extractTokens(design).lineHeightDetails, unit === null ? [] : [{ value, unit, css }]);
    assert.deepEqual(buildTree(design).tree[0].children[0].style, style);
  }
});

test('linked text styles preserve line height units and allow local overrides', () => {
  const node = { id: 'text', type: 'text', textLink: 'shared', textbox: { text: '标题', segments: [] } };
  const { design } = styleForNode(node);
  design.styles = { textStyles: [{ id: 'shared', data: { fontSize: 16, lineHeight: { value: 150, unit: 'per' } } }] };
  assert.equal(extractNodeStyle(design, node).css.lineHeight, '150%');
  node.textbox.segments = [{ lineHeight: { value: 24, unit: 'px' } }];
  assert.equal(extractNodeStyle(design, node).css.lineHeight, '48rpx');
});

test('px/rpx conversion changes lengths but never percentage line heights or gradients', () => {
  const { style } = gradientStyle(buttonGradient);
  const px = styleToCss({ ...style, units: { cssUnit: 'px', scale: 1 } });
  assert.equal(px.width, '112px');
  assert.equal(px.background, style.css.background);
  const { style: text } = styleForNode({ id: 'text', type: 'text', textbox: {
    text: '标题', segments: [{ fontSize: 16, lineHeight: { value: 150, unit: 'per' } }],
  } });
  const textPx = styleToCss({ ...text, units: { cssUnit: 'px', scale: 1 } });
  assert.equal(textPx.fontSize, '16px');
  assert.equal(textPx.lineHeight, '150%');
  assert.equal(styleToCss({ ...text, typography: { ...text.typography, lineHeight: 24, lineHeightUnit: 'px' },
    units: { cssUnit: 'px', scale: 1 } }).lineHeight, '24px');
});

test('token details distinguish identical numeric line heights with different units', () => {
  const nodes = ['per', 'px'].map((unit) => ({ id: unit, type: 'text', textbox: {
    text: '标题', segments: [{ lineHeight: { value: 150, unit } }],
  } }));
  const design = { pages: [{ id: 'frame', type: 'artboard', rect: { w: 375, h: 812 }, children: nodes }] };
  const tokens = extractTokens(design);
  assert.deepEqual(tokens.lineHeights, [150]); // Legacy value-only field.
  assert.equal(tokens.lineHeightDetails.length, 2);
  assert.ok(tokens.lineHeightDetails.some((t) => t.unit === '%' && t.css === '150%'));
  assert.ok(tokens.lineHeightDetails.some((t) => t.unit === 'px' && t.css === '300rpx'));
});

test('inside strokes use border-box without changing outside or absent strokes', () => {
  for (const align of ['inside', 'outside', 'center']) {
    const { style } = styleForNode({ id: 'border', strokes: [{ w: 1, align,
      fills: [{ type: 'color', color: { r: 255, g: 255, b: 255 } }] }] });
    assert.equal(style.css.boxSizing, align === 'inside' ? 'border-box' : undefined);
  }
  assert.equal(styleForNode({ id: 'empty' }).style.css.boxSizing, undefined);
});

test('tree, flat layers, metadata, and tokens are development-ready', () => {
  const meta = extractDesignMeta(genome, { id: 'file-1', name: '学校小程序' });
  assert.equal(meta.frameCount, 1);
  assert.equal(meta.frames[0].width, 375);

  const flat = flattenGenome(genome, { maxNodes: 20 });
  assert.equal(flat.nodes.length, 4);
  assert.equal(flat.nodes.find((node) => node.id === '1:3').depth, 2);

  const result = buildTree(genome, { withStyle: true, maxDepth: 4, maxNodes: 20 });
  assert.equal(result.nodeCount, 4);
  assert.equal(result.tree[0].children[0].children[0].text, '新增学生');

  const tokens = extractTokens(genome);
  assert.ok(tokens.colors.includes('#1677ff'));
  assert.ok(tokens.fontSizes.includes(18));
  assert.ok(tokens.fontFamilies.includes('PingFang SC'));
  assert.ok(tokens.radii.includes(8));
  assert.ok(tokens.radii.includes(12));
  assert.ok(tokens.spacing.includes(16));
  assert.ok(tokens.spacing.includes(20));
  assert.equal(tokens.shadows.length, 1);
});
