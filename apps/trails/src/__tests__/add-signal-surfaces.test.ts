import { expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { deriveMcpTools } from '@ontrails/mcp';

import { trailsMcpApp } from '../mcp-app.js';
import { trailsMcpSurfaceOptions } from '../mcp-options.js';
import {
  createResourceProject,
  resourceScaffoldPermit,
} from './resource-scaffold.fixture.js';

const addScaffold = (dir: string, family: 'signal' | 'resource' | 'trail') => {
  const child = Bun.spawnSync({
    cmd: [
      process.execPath,
      resolve(import.meta.dir, '../../bin/trails.ts'),
      'add',
      family,
      'entity.updated',
      '--description',
      `CLI ${family}`,
      ...(family === 'trail' ? ['--example-name', 'example'] : []),
      '--permit',
      JSON.stringify(resourceScaffoldPermit),
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
  return JSON.parse(child.stdout.toString()) as { created: string[] };
};

test('the CLI generates a signal scaffold and MCP does not advertise it', () => {
  const dir = createResourceProject();
  try {
    addScaffold(dir, 'signal');
    expect(existsSync(join(dir, 'src/signals/entity-updated.ts'))).toBe(true);
    expect(
      existsSync(join(dir, '__tests__/signals/entity-updated.test.ts'))
    ).toBe(true);
    const tools = deriveMcpTools(trailsMcpApp, trailsMcpSurfaceOptions);
    if (tools.isErr()) {
      throw tools.error;
    }
    expect(tools.value.map((tool) => tool.trailId)).not.toContain('add.signal');
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

for (const family of ['resource', 'trail'] as const) {
  test(`the signal test survives scaffolding a ${family} with the same ID`, () => {
    const dir = createResourceProject();
    try {
      const { created } = addScaffold(dir, 'signal');
      const signalTestPath = created.find((path) => path.endsWith('.test.ts'));
      if (signalTestPath === undefined) {
        throw new Error('Expected a generated signal test');
      }
      const signalTest = join(dir, signalTestPath);
      const authored = `${readFileSync(signalTest, 'utf8')}\n// Authored signal test edit.\n`;
      writeFileSync(signalTest, authored);

      const sibling = addScaffold(dir, family);
      expect(readFileSync(signalTest, 'utf8')).toBe(authored);
      expect(sibling.created).toContain('__tests__/entity-updated.test.ts');
      expect(sibling.created).not.toContain(signalTestPath);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }, 15_000);
}
