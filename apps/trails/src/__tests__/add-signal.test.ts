import { expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { executeTrail, PermissionError, ValidationError } from '@ontrails/core';

import { addSignal } from '../trails/add-signal.js';
import { createResourceProject } from './resource-scaffold.fixture.js';

test('signal scaffold produces compiling typed declarations without invented producers', async () => {
  const dir = createResourceProject();
  try {
    for (const id of [
      'entity.updated',
      'class',
      'signal',
      'z',
      '_draft.entity.updated',
    ]) {
      const result = await executeTrail(
        addSignal,
        { description: '  Entity update event  ', id },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'signal-scaffold', scopes: ['project:write'] },
          },
        }
      );
      if (result.isErr()) {
        throw result.error;
      }
      const module = id.replaceAll('.', '-').replace('_draft-', '_draft.');
      expect(result.value).toEqual({
        created: [`src/signals/${module}.ts`, `__tests__/${module}.test.ts`],
      });
      const source = readFileSync(
        join(dir, `src/signals/${module}.ts`),
        'utf8'
      );
      expect(source).toContain(`export const ${id.replaceAll('.', '_')}Signal`);
      expect(source).toContain('description: "Entity update event"');
      expect(source).not.toContain('from:');
    }
    for (const args of [
      ['test'],
      [
        Bun.resolveSync('typescript/bin/tsc', import.meta.dir),
        '--noEmit',
        '--project',
        join(dir, 'tsconfig.json'),
      ],
    ]) {
      const child = Bun.spawnSync({
        cmd: [process.execPath, ...args],
        cwd: dir,
        stderr: 'pipe',
        stdout: 'pipe',
      });
      expect({
        code: child.exitCode,
        stderr: child.stderr.toString(),
        stdout: child.stdout.toString(),
      }).toMatchObject({ code: 0 });
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test('invalid signal scaffold inputs never create files', async () => {
  for (const input of [
    { description: 'Unsafe ID', id: '../escape' },
    { description: '', id: 'entity.updated' },
    { description: ' \t\n ', id: 'entity.updated' },
  ]) {
    const dir = createResourceProject();
    try {
      const result = await executeTrail(addSignal, input, {
        ctx: {
          cwd: dir,
          permit: { id: 'signal-scaffold', scopes: ['project:write'] },
        },
      });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) {
        throw new Error('Expected invalid input');
      }
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(existsSync(join(dir, 'src'))).toBe(false);
      expect(existsSync(join(dir, '__tests__'))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

test('signal scaffolding requires write permission and rejects dry-run', async () => {
  const dir = createResourceProject();
  try {
    const input = { description: 'Entity update event', id: 'entity.updated' };
    const denied = await executeTrail(addSignal, input, { ctx: { cwd: dir } });
    if (denied.isOk()) {
      throw new Error('Expected missing write permit');
    }
    expect(denied.error).toBeInstanceOf(PermissionError);
    const preview = await executeTrail(addSignal, input, {
      ctx: {
        cwd: dir,
        permit: { id: 'signal-scaffold', scopes: ['project:write'] },
      },
      dryRun: true,
    });
    if (preview.isOk()) {
      throw new Error('Expected unsupported dry-run');
    }
    expect(preview.error).toBeInstanceOf(ValidationError);
    expect(existsSync(join(dir, 'src'))).toBe(false);
    expect(existsSync(join(dir, '__tests__'))).toBe(false);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
