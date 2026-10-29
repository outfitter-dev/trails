import { expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  ConflictError,
  executeTrail,
  InternalError,
  ValidationError,
} from '@ontrails/core';

import { addResource } from '../trails/add-resource.js';
import { addSignal } from '../trails/add-signal.js';
import { createResourceProject } from './resource-scaffold.fixture.js';

for (const [family, scaffold, id, module] of [
  ['resource', addResource, 'db.main', 'db-main'],
  ['signal', addSignal, 'entity.updated', 'entity-updated'],
] as const) {
  test(`${family}: preflights blocked parent directories before writing`, async () => {
    const dir = createResourceProject();
    try {
      writeFileSync(join(dir, '__tests__'), 'Authored parent file');
      const result = await executeTrail(
        scaffold,
        { description: 'Starter', id },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'scaffold-test', scopes: ['project:write'] },
          },
        }
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) {
        throw new Error('Expected parent conflict');
      }
      expect(result.error).toBeInstanceOf(ConflictError);
      expect(existsSync(join(dir, 'src'))).toBe(false);
      expect(readFileSync(join(dir, '__tests__'), 'utf8')).toBe(
        'Authored parent file'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test(`${family}: late failure removes owned files and permits retry`, async () => {
    const dir = createResourceProject();
    const write = fs.writeFileSync;
    let calls = 0;
    const mocked = spyOn(fs, 'writeFileSync').mockImplementation(
      (path, data, options) => {
        calls += 1;
        if (calls === 2) {
          throw new Error('Simulated second-file write failure');
        }
        return write(path, data, options);
      }
    );
    try {
      const result = await executeTrail(
        scaffold,
        { description: 'Starter', id },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'scaffold-test', scopes: ['project:write'] },
          },
        }
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) {
        throw new Error('Expected simulated write failure');
      }
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toBe('Failed to create scaffold files.');
      expect(existsSync(join(dir, `src/${family}s/${module}.ts`))).toBe(false);
      expect(existsSync(join(dir, `__tests__/${module}.test.ts`))).toBe(false);
      expect(existsSync(join(dir, 'package.json'))).toBe(true);
      mocked.mockRestore();
      const retry = await executeTrail(
        scaffold,
        { description: 'Starter', id },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'scaffold-test', scopes: ['project:write'] },
          },
        }
      );
      expect(retry.isOk()).toBe(true);
    } finally {
      mocked.mockRestore();
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test(`${family}: exclusive creation preserves a new foreign target`, async () => {
    const dir = createResourceProject();
    const target = join(dir, `__tests__/${module}.test.ts`);
    const open = fs.openSync;
    const mocked = spyOn(fs, 'openSync').mockImplementation(
      (path, flags, mode) => {
        if (String(path) === target) {
          writeFileSync(target, 'Authored concurrent test');
        }
        return open(path, flags, mode);
      }
    );
    try {
      const result = await executeTrail(
        scaffold,
        { description: 'Starter', id },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'scaffold-test', scopes: ['project:write'] },
          },
        }
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) {
        throw new Error('Expected concurrent target conflict');
      }
      expect(result.error).toBeInstanceOf(ConflictError);
      expect(existsSync(join(dir, `src/${family}s/${module}.ts`))).toBe(false);
      expect(readFileSync(target, 'utf8')).toBe('Authored concurrent test');
    } finally {
      mocked.mockRestore();
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test(`${family}: failed cleanup reports remaining owned files`, async () => {
    const dir = createResourceProject();
    const target = join(dir, `__tests__/${module}.test.ts`);
    const write = fs.writeFileSync;
    let calls = 0;
    const mockedWrite = spyOn(fs, 'writeFileSync').mockImplementation(
      (path, data, options) => {
        calls += 1;
        if (calls === 2) {
          throw new Error('Simulated write failure');
        }
        return write(path, data, options);
      }
    );
    const unlink = fs.unlinkSync;
    const mockedUnlink = spyOn(fs, 'unlinkSync').mockImplementation((path) => {
      if (String(path) === target) {
        throw new Error('Simulated cleanup failure');
      }
      return unlink(path);
    });
    try {
      const result = await executeTrail(
        scaffold,
        { description: 'Starter', id },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'scaffold-test', scopes: ['project:write'] },
          },
        }
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) {
        throw new Error('Expected cleanup failure');
      }
      expect(result.error).toBeInstanceOf(InternalError);
      if (!(result.error instanceof InternalError)) {
        throw result.error;
      }
      expect(result.error.context?.['remaining']).toEqual([target]);
      expect(result.error.message).toContain('could not be removed');
      expect(existsSync(join(dir, `src/${family}s/${module}.ts`))).toBe(false);
      expect(existsSync(target)).toBe(true);
    } finally {
      mockedWrite.mockRestore();
      mockedUnlink.mockRestore();
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test(`${family}: rollback preserves a replacement file`, async () => {
    const dir = createResourceProject();
    const target = join(dir, `src/${family}s/${module}.ts`);
    const write = fs.writeFileSync;
    let calls = 0;
    const mocked = spyOn(fs, 'writeFileSync').mockImplementation(
      (path, data, options) => {
        calls += 1;
        if (calls === 2) {
          fs.renameSync(target, join(dir, 'original-resource.ts'));
          write(target, 'Authored replacement');
          throw new Error('Simulated later failure');
        }
        return write(path, data, options);
      }
    );
    try {
      const result = await executeTrail(
        scaffold,
        { description: 'Starter', id },
        {
          ctx: {
            cwd: dir,
            permit: { id: 'scaffold-test', scopes: ['project:write'] },
          },
        }
      );
      expect(result.isErr()).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('Authored replacement');
      expect(existsSync(join(dir, `__tests__/${module}.test.ts`))).toBe(false);
    } finally {
      mocked.mockRestore();
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test(`${family}: rejects symlinked parents before outside writes`, async () => {
    for (const parent of ['src', `src/${family}s`, '__tests__']) {
      const dir = createResourceProject();
      const outside = mkdtempSync(join(tmpdir(), 'resource-scaffold-outside-'));
      try {
        writeFileSync(join(outside, 'sentinel'), 'Preserve outside content');
        const link = join(dir, parent);
        mkdirSync(dirname(link), { recursive: true });
        symlinkSync(outside, link, 'dir');
        const result = await executeTrail(
          scaffold,
          { description: 'Starter', id },
          {
            ctx: {
              cwd: dir,
              permit: { id: 'scaffold-test', scopes: ['project:write'] },
            },
          }
        );
        expect(result.isErr()).toBe(true);
        if (result.isOk()) {
          throw new Error('Expected unsafe parent rejection');
        }
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(readdirSync(outside)).toEqual(['sentinel']);
        expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe(
          'Preserve outside content'
        );
        expect(existsSync(join(dir, `src/${family}s/${module}.ts`))).toBe(
          false
        );
      } finally {
        rmSync(dir, { force: true, recursive: true });
        rmSync(outside, { force: true, recursive: true });
      }
    }
  });
}
