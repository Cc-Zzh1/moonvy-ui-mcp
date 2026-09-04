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
  assert.equal(style.background, 'radial-gradient(circle at 2.5333% 2.3305%, #f4edff 0%, #dff1ff 80.4463%, #ffffff 100%)');
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
