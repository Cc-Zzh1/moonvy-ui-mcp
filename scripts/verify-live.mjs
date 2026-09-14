import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Opt-in authenticated, read-only verification. Never invoked by npm test.
const baseline = JSON.parse(await readFile(new URL('../test/fixtures/css-panel-baselines.json', import.meta.url), 'utf8'));
if (!process.env.MOONVY_TOKEN) throw new Error('Set MOONVY_TOKEN or DOTENV_CONFIG_PATH before running live verification.');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/server.js', import.meta.url))],
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, MOONVY_CSS_UNIT: 'rpx', MOONVY_RPX_SCALE: '2' },
  stderr: 'pipe',
});
const client = new Client({ name: 'moonvy-css-verifier', version: '1.0.0' });
let totalNodes = 0;
let totalSamples = 0;
let passed = 0;

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name} failed; check credentials and project access.`);
  return JSON.parse(result.content.find((c) => c.type === 'text').text);
}

try {
  await client.connect(transport);
  await call('moonvy_clear_cache');
  for (const design of baseline.designs) {
    const url = `https://moonvy.com/project/${baseline.projectId}/${baseline.dirId}/${design.fileId}`;
    try {
      const meta = await call('moonvy_get_design', { url });
      const options = { url, maxDepth: 99, maxNodes: 5000 };
      const spec = await call('moonvy_get_ui_spec', options);
      const tokens = await call('moonvy_extract_tokens', { url });
      const tree = await call('moonvy_get_tree', options);
      assert.equal(spec.truncated, false, 'UI spec is truncated');
      assert.deepEqual(spec.tokens, tokens, 'Token APIs disagree');
      assert.deepEqual(spec.tree, tree.tree, 'Tree APIs disagree');
      const index = new Map();
      function visit(node, x = 0, y = 0) {
        const position = [x + node.relativeX, y + node.relativeY];
        index.set(node.id, { node, position });
        for (const child of node.children ?? []) visit(child, ...position);
      }
      spec.tree.forEach((node) => visit(node));
      for (const sample of design.samples) {
        const result = await call('moonvy_get_node_style', { url, nodeId: sample.nodeId });
        const indexed = index.get(sample.nodeId);
        assert.ok(indexed, `Missing node ${sample.nodeId}`);
        assert.deepEqual(result.style, indexed.node.style, `Style APIs disagree for ${sample.nodeId}`);
        for (const [property, expected] of Object.entries(sample.css)) {
          assert.equal(result.style.css[property], expected, `${sample.nodeId}: ${property}`);
        }
        assert.deepEqual(indexed.position.map((v) => Math.round(v * result.style.units.scale * 100) / 100),
          sample.canvasPosition, `${sample.nodeId}: accumulated canvas position`);
        if (sample.css.background?.includes('gradient(')) assert.ok(tokens.gradients.includes(sample.css.background));
        if (sample.css.lineHeight) assert.ok(tokens.lineHeightDetails.some((t) => t.css === sample.css.lineHeight));
      }
      totalNodes += spec.nodeCount;
      totalSamples += design.samples.length;
      passed++;
      console.log(JSON.stringify({ passed: true, fileId: design.fileId, title: meta.title,
        updatedAt: meta.updatedAt, nodes: spec.nodeCount, cssSamples: design.samples.length }));
    } catch (error) {
      // Do not print server responses or arbitrary exception strings containing private data.
      console.error(JSON.stringify({ passed: false, fileId: design.fileId,
        error: error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Verification request failed' }));
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify({ baselineDate: baseline.observedAt, passedDesigns: passed,
    totalDesigns: baseline.designs.length, totalNodes, totalSamples, serverVersion: client.getServerVersion()?.version }));
} finally {
  await client.close();
}
