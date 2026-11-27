import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import {
  createResourceProject,
  resourceScaffoldPermit,
} from './resource-scaffold.fixture.js';

const addThroughCli = (cwd: string, kind: 'resource' | 'trail', id: string) =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      resolve(import.meta.dir, '../../bin/trails.ts'),
      'add',
      kind,
      id,
      '--description',
      'Scaffold from the CLI',
      ...(kind === 'trail' ? ['--example-name', 'Example'] : []),
      '--permit',
      JSON.stringify(resourceScaffoldPermit),
      '--json',
    ],
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });

test('resource scaffold is reachable through the actual CLI', () => {
  const dir = createResourceProject();
  try {
    const child = addThroughCli(dir, 'resource', 'db.main');
    expect({
      code: child.exitCode,
      stderr: child.stderr.toString(),
      stdout: child.stdout.toString(),
    }).toMatchObject({ code: 0 });
    expect(existsSync(join(dir, 'src/resources/db-main.ts'))).toBe(true);
    const trail = addThroughCli(dir, 'trail', 'db.read');
    expect(trail.exitCode).toBe(0);
    expect(existsSync(join(dir, 'src/trails/db-read.ts'))).toBe(true);
    expect(existsSync(join(dir, '__tests__/db-main.test.ts'))).toBe(true);
    expect(existsSync(join(dir, '__tests__/db-read.test.ts'))).toBe(true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

for (const [first, second] of [
  ['resource', 'trail'],
  ['trail', 'resource'],
] as const) {
  test(`the CLI preserves edited ${first} tests when the ${second} scaffold collides`, () => {
    const dir = createResourceProject();
    try {
      expect(addThroughCli(dir, first, 'entity.updated').exitCode).toBe(0);
      const testPath = '__tests__/entity-updated.test.ts';
      const testFile = join(dir, testPath);
      const edited = Buffer.concat([
        readFileSync(testFile),
        Buffer.from('// Keep this edit.\r\n'),
      ]);
      writeFileSync(testFile, edited);
      const existingDefinition = join(dir, `src/${first}s/entity-updated.ts`);
      const existingSource = readFileSync(existingDefinition);
      const newDefinition = join(dir, `src/${second}s/entity-updated.ts`);
      const conflict = addThroughCli(dir, second, 'entity.updated');

      expect(readFileSync(testFile)).toEqual(edited);
      expect(readFileSync(existingDefinition)).toEqual(existingSource);
      expect(existsSync(dirname(newDefinition))).toBe(false);
      expect(conflict.exitCode).toBe(3);
      expect(conflict.stderr.toString()).toContain(testPath);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

test('the CLI names a pre-existing trail definition without creating its test', () => {
  const dir = createResourceProject();
  try {
    const sourcePath = 'src/trails/entity-updated.ts';
    const sourceFile = join(dir, sourcePath);
    const edited = Buffer.from('// Existing trail definition.\r\n');
    mkdirSync(dirname(sourceFile), { recursive: true });
    writeFileSync(sourceFile, edited);

    const conflict = addThroughCli(dir, 'trail', 'entity.updated');

    expect(readFileSync(sourceFile)).toEqual(edited);
    expect(existsSync(join(dir, '__tests__'))).toBe(false);
    expect(conflict.exitCode).toBe(3);
    expect(conflict.stderr.toString()).toContain(sourcePath);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

for (const [mode, version] of [
  ['legacy', '2025-11-25'],
  [{ pin: '2026-07-28' }, '2026-07-28'],
] as const) {
  test(`the shipped MCP server does not advertise the CLI resource scaffold on ${version}`, async () => {
    const client = new Client(
      { name: 'trails-scaffold-test', version: '1.0.0' },
      { versionNegotiation: { mode } }
    );
    const transport = new StdioClientTransport({
      args: [resolve(import.meta.dir, '../mcp.ts')],
      command: process.execPath,
    });
    try {
      await client.connect(transport);
      expect(client.getNegotiatedProtocolVersion()).toBe(version);
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain('trails_add_trail');
      expect(names).not.toContain('trails_add_resource');
    } finally {
      await client.close();
    }
  }, 15_000);
}
