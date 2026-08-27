import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('stdio MCP initializes and exposes the expected tools', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(projectRoot, 'src/server.js')],
    cwd: projectRoot,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'moonvy-ui-mcp-test', version: '0.1.0' });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      'moonvy_clear_cache',
      'moonvy_download_asset',
      'moonvy_extract_tokens',
      'moonvy_get_design',
      'moonvy_get_node_style',
      'moonvy_get_tree',
      'moonvy_get_ui_spec',
      'moonvy_list_layers',
      'moonvy_list_pages',
      'moonvy_parse_url',
    ]);

    const parsed = await client.callTool({
      name: 'moonvy_parse_url',
      arguments: {
        url: 'https://moonvy.com/project/project-id/dir-id/file-id',
      },
    });
    assert.equal(parsed.isError, undefined);
    const payload = JSON.parse(parsed.content[0].text);
    assert.equal(payload.projectId, 'project-id');
    assert.equal(payload.dirId, 'dir-id');
    assert.equal(payload.fileId, 'file-id');
  } finally {
    await client.close();
  }
});
