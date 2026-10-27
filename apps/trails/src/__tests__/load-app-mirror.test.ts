import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { PermissionError, ValidationError } from '@ontrails/core';

import {
  createLoadAppMirrorRootPath,
  removeLoadAppMirrorRoot,
  removeLoadAppMirrorRootQuietly,
  resolveLoadAppMirrorFilePath,
  writeLoadAppMirrorFile,
} from '../load-app-mirror.js';

const tempRoot = (): string =>
  join(
    tmpdir(),
    `trails-load-app-mirror-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );

describe('load-app mirror helpers', () => {
  test('creates absolute mirror roots outside the target worktree by default', () => {
    const mirrorRoot = createLoadAppMirrorRootPath(process.cwd());

    expect(isAbsolute(mirrorRoot)).toBe(true);
    expect(relative(process.cwd(), mirrorRoot).startsWith('..')).toBe(true);
    removeLoadAppMirrorRootQuietly(mirrorRoot);
  });

  test('writes source bytes under the load-app mirror root', async () => {
    const root = tempRoot();

    try {
      const sourcePath = join(root, 'src', 'app.ts');
      const mirrorRoot = createLoadAppMirrorRootPath(process.cwd());
      mkdirSync(dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, 'export const app = true;\n');

      const mirrorPath = resolveLoadAppMirrorFilePath(sourcePath, mirrorRoot);
      expect(mirrorPath.isOk()).toBe(true);

      const written = await writeLoadAppMirrorFile(sourcePath, mirrorRoot);
      expect(written.isOk()).toBe(true);

      if (written.isErr()) {
        throw written.error;
      }

      expect(written.value).toBe(mirrorPath.unwrap());
      expect(readFileSync(written.value, 'utf8')).toBe(
        'export const app = true;\n'
      );
      expect(removeLoadAppMirrorRoot(mirrorRoot).isOk()).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('rejects mirror writes outside load-app mirror roots', async () => {
    const root = tempRoot();

    try {
      const sourcePath = join(root, 'src', 'app.ts');
      const invalidMirrorRoot = join(root, 'not-a-mirror');
      mkdirSync(dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, 'export const app = true;\n');

      const written = await writeLoadAppMirrorFile(
        sourcePath,
        invalidMirrorRoot
      );
      expect(written.isErr()).toBe(true);
      if (written.isErr()) {
        expect(written.error).toBeInstanceOf(PermissionError);
      }

      expect(existsSync(invalidMirrorRoot)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('rejects relative source paths before deriving a mirror target', () => {
    const mirrorRoot = createLoadAppMirrorRootPath(process.cwd());

    const resolved = resolveLoadAppMirrorFilePath('src/app.ts', mirrorRoot);

    expect(resolved.isErr()).toBe(true);
    if (resolved.isErr()) {
      expect(resolved.error).toBeInstanceOf(ValidationError);
    }
    removeLoadAppMirrorRootQuietly(mirrorRoot);
  });

  test('removes only load-app mirror roots', () => {
    const root = tempRoot();

    try {
      const mirrorRoot = createLoadAppMirrorRootPath(process.cwd());
      const protectedDir = join(root, 'project');
      mkdirSync(mirrorRoot, { recursive: true });
      mkdirSync(protectedDir, { recursive: true });

      const rejected = removeLoadAppMirrorRoot(protectedDir);
      expect(rejected.isErr()).toBe(true);
      if (rejected.isErr()) {
        expect(rejected.error).toBeInstanceOf(PermissionError);
      }
      expect(existsSync(protectedDir)).toBe(true);

      const removed = removeLoadAppMirrorRoot(mirrorRoot);
      expect(removed.isOk()).toBe(true);
      expect(existsSync(mirrorRoot)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('quiet removal ignores invalid mirror roots', () => {
    const root = tempRoot();

    try {
      const protectedDir = join(root, 'project');
      mkdirSync(protectedDir, { recursive: true });

      expect(() => removeLoadAppMirrorRootQuietly(protectedDir)).not.toThrow();
      expect(existsSync(protectedDir)).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
