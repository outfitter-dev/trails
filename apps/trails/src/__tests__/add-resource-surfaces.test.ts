import { expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { deriveMcpTools } from '@ontrails/mcp';
import { createTrailContext } from '@ontrails/core';

import { app } from '../app.js';
import { trailsMcpSurfaceOptions } from '../mcp-options.js';
import { createResourceProject } from './resource-scaffold.fixture.js';

test('resource scaffold is reachable through the actual CLI and operator MCP selection', async () => {
  const dir = createResourceProject();
  const permit = { id: 'scaffold-surface-test', scopes: ['project:write'] };
  try {
    const child = Bun.spawnSync({
      cmd: [
        process.execPath,
        resolve(import.meta.dir, '../../bin/trails.ts'),
        'add',
        'resource',
        'db.main',
        '--description',
        'CLI resource',
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
    expect(existsSync(join(dir, 'src/resources/db-main.ts'))).toBe(true);
    const tools = deriveMcpTools(app, {
      ...trailsMcpSurfaceOptions,
      createContext: () => createTrailContext({ cwd: dir, permit }),
    });
    if (tools.isErr()) {
      throw tools.error;
    }
    const tool = tools.value.find((entry) => entry.trailId === 'add.resource');
    if (tool === undefined) {
      throw new Error('Expected operator MCP resource scaffold');
    }
    const result = await tool.handler(
      { description: 'MCP resource', id: 'mcp.cache' },
      {}
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      created: ['src/resources/mcp-cache.ts', '__tests__/mcp-cache.test.ts'],
    });
    expect(existsSync(join(dir, 'src/resources/mcp-cache.ts'))).toBe(true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
