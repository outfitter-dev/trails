import { expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { deriveMcpTools } from '@ontrails/mcp';
import { createTrailContext } from '@ontrails/core';

import { app } from '../app.js';
import { trailsMcpSurfaceOptions } from '../mcp-options.js';
import { createResourceProject } from './resource-scaffold.fixture.js';

test('signal scaffold is reachable through the actual CLI and operator MCP selection', async () => {
  const dir = createResourceProject();
  const permit = { id: 'scaffold-surface-test', scopes: ['project:write'] };
  try {
    const child = Bun.spawnSync({
      cmd: [
        process.execPath,
        resolve(import.meta.dir, '../../bin/trails.ts'),
        'add',
        'signal',
        'entity.updated',
        '--description',
        'CLI signal',
        '--permit',
        JSON.stringify(permit),
        '--json',
      ],
      cwd: dir,
      stderr: 'pipe',
      stdout: 'pipe',
    });
    expect({
      code: child.exitCode,
      stderr: child.stderr.toString(),
      stdout: child.stdout.toString(),
    }).toMatchObject({ code: 0 });
    expect(existsSync(join(dir, 'src/signals/entity-updated.ts'))).toBe(true);
    const tools = deriveMcpTools(app, {
      ...trailsMcpSurfaceOptions,
      createContext: () => createTrailContext({ cwd: dir, permit }),
    });
    if (tools.isErr()) {
      throw tools.error;
    }
    const tool = tools.value.find((entry) => entry.trailId === 'add.signal');
    if (tool === undefined) {
      throw new Error('Expected operator MCP signal scaffold');
    }
    const result = await tool.handler(
      { description: 'MCP signal', id: 'mcp.updated' },
      {}
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      created: ['src/signals/mcp-updated.ts', '__tests__/mcp-updated.test.ts'],
    });
    expect(existsSync(join(dir, 'src/signals/mcp-updated.ts'))).toBe(true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
