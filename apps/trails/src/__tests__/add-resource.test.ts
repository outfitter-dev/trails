import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  ConflictError,
  executeTrail,
  PermissionError,
  ValidationError,
} from '@ontrails/core';

import { addResource } from '../trails/add-resource.js';

import { createResourceProject } from './resource-scaffold.fixture.js';

test('resource scaffold writes a definition and runnable tests with safe identifiers', async () => {
  const dir = createResourceProject();
  try {
    for (const id of ['db.main', 'class', 'resource', 'z', '_draft.db.main']) {
      const result = await executeTrail(
        addResource,
        { description: '  Editable in-memory starter  ', id },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'scaffold-test', scopes: ['project:write'] },
          },
        }
      );
      if (result.isErr()) {
        throw result.error;
      }
      const module = id.replaceAll('.', '-').replace('_draft-', '_draft.');
      expect(result.value).toEqual({
        created: [`src/resources/${module}.ts`, `__tests__/${module}.test.ts`],
      });
      const source = readFileSync(
        join(dir, `src/resources/${module}.ts`),
        'utf8'
      );
      expect(source).toContain(
        `export const ${id.replaceAll('.', '_')}Resource`
      );
      expect(source).toContain('description: "Editable in-memory starter"');
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

test('resource scaffolding rejects invalid IDs without creating files', async () => {
  for (const id of ['../escape', 'db:main', 'db/main']) {
    const dir = createResourceProject();
    try {
      const result = await executeTrail(
        addResource,
        { description: 'Invalid resource', id },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'scaffold-test', scopes: ['project:write'] },
          },
        }
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) {
        throw new Error('Expected invalid scaffold ID');
      }
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(existsSync(join(dir, 'src'))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

test('resource scaffolding requires project write permission', async () => {
  const dir = createResourceProject();
  try {
    const result = await executeTrail(
      addResource,
      { description: 'Protected starter', id: 'db.main' },
      { ctx: { cwd: dir } }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected missing permit');
    }
    expect(result.error).toBeInstanceOf(PermissionError);
    expect(existsSync(join(dir, 'src'))).toBe(false);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test('resource scaffolding rejects empty or whitespace-only descriptions before writing', async () => {
  for (const description of ['', '   ', '\t\n']) {
    const dir = createResourceProject();
    try {
      const result = await executeTrail(
        addResource,
        { description, id: 'db.main' },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'scaffold-test', scopes: ['project:write'] },
          },
        }
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) {
        throw new Error('Expected meaningful-description validation');
      }
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(existsSync(join(dir, 'src'))).toBe(false);
      expect(existsSync(join(dir, '__tests__'))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

test('resource scaffolding preserves existing files before any writes', async () => {
  const dir = createResourceProject();
  try {
    mkdirSync(join(dir, '__tests__'));
    const path = join(dir, '__tests__/db-main.test.ts');
    writeFileSync(path, '// Authored test\n');
    const result = await executeTrail(
      addResource,
      { description: 'New starter', id: 'db.main' },
      {
        ctx: {
          cwd: dir,
          permit: { id: 'scaffold-test', scopes: ['project:write'] },
        },
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected existing-file conflict');
    }
    expect(result.error).toBeInstanceOf(ConflictError);
    expect(readFileSync(path, 'utf8')).toBe('// Authored test\n');
    expect(existsSync(join(dir, 'src'))).toBe(false);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test('resource scaffolding rejects dry-run without writing files', async () => {
  const dir = createResourceProject();
  try {
    const result = await executeTrail(
      addResource,
      { description: 'Preview starter', id: 'db.main' },
      {
        ctx: {
          cwd: dir,
          permit: { id: 'scaffold-test', scopes: ['project:write'] },
        },
        dryRun: true,
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected unsupported dry-run');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(existsSync(join(dir, 'src'))).toBe(false);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
