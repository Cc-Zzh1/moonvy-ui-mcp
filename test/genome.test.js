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
  assert.equal(style.css.width, '120px');
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
