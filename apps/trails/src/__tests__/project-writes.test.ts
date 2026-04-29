import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PermissionError, ValidationError } from '@ontrails/core';

import {
  projectPathExists,
  renameContainedProjectPath,
  resolveProjectDir,
  validateProjectName,
  validateTrailId,
  writeContainedProjectPath,
  writeProjectFile,
} from '../project-writes.js';

const tempRoot = (): string =>
  join(
    tmpdir(),
    `trails-project-writes-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

describe('project write helpers', () => {
  test('rejects path-shaped project names before resolving a project directory', () => {
    for (const name of ['../outside', 'nested/name', 'bad\nname']) {
      const result = validateProjectName(name);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ValidationError);
      }
    }
  });

  test('rejects path-shaped trail ids before deriving file or export names', () => {
    for (const id of ['../outside', 'entity..show', 'entity.show-now']) {
      const result = validateTrailId(id);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ValidationError);
      }
    }
  });

  test('contains project directories and file writes under their root', async () => {
    const root = tempRoot();

    try {
      const projectDir = resolveProjectDir(root, 'safe-project');
      expect(projectDir.isOk()).toBe(true);

      if (projectDir.isErr()) {
        throw projectDir.error;
      }

      const written = await writeProjectFile(
        projectDir.value,
        'src/app.ts',
        'export const ok = true;\n'
      );
      expect(written.isOk()).toBe(true);
      expect(readFileSync(join(projectDir.value, 'src/app.ts'), 'utf8')).toBe(
        'export const ok = true;\n'
      );

      const escaped = await writeProjectFile(
        projectDir.value,
        '../escape.ts',
        'export const escaped = true;\n'
      );
      expect(escaped.isErr()).toBe(true);
      if (escaped.isErr()) {
        expect(escaped.error).toBeInstanceOf(PermissionError);
      }
      expect(existsSync(join(dirname(projectDir.value), 'escape.ts'))).toBe(
        false
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('contains derived project paths under their root', async () => {
    const root = tempRoot();

    try {
      const projectDir = resolveProjectDir(root, 'safe-project');
      expect(projectDir.isOk()).toBe(true);

      if (projectDir.isErr()) {
        throw projectDir.error;
      }

      const sourcePath = join(projectDir.value, 'src', 'before.ts');
      const targetPath = join(projectDir.value, 'src', 'after.ts');
      const outsidePath = join(root, 'outside.ts');

      const missing = projectPathExists(projectDir.value, sourcePath);
      expect(missing.isOk()).toBe(true);
      if (missing.isOk()) {
        expect(missing.value).toBe(false);
      }

      const written = await writeContainedProjectPath(
        projectDir.value,
        sourcePath,
        'export const before = true;\n'
      );
      expect(written.isOk()).toBe(true);

      const existing = projectPathExists(projectDir.value, sourcePath);
      expect(existing.isOk()).toBe(true);
      if (existing.isOk()) {
        expect(existing.value).toBe(true);
      }

      const escapedExists = projectPathExists(projectDir.value, outsidePath);
      expect(escapedExists.isErr()).toBe(true);
      if (escapedExists.isErr()) {
        expect(escapedExists.error).toBeInstanceOf(PermissionError);
      }

      const escapedWrite = await writeContainedProjectPath(
        projectDir.value,
        outsidePath,
        'export const outside = true;\n'
      );
      expect(escapedWrite.isErr()).toBe(true);
      if (escapedWrite.isErr()) {
        expect(escapedWrite.error).toBeInstanceOf(PermissionError);
      }

      const escapedRename = renameContainedProjectPath(
        projectDir.value,
        sourcePath,
        outsidePath
      );
      expect(escapedRename.isErr()).toBe(true);
      if (escapedRename.isErr()) {
        expect(escapedRename.error).toBeInstanceOf(PermissionError);
      }

      const renamed = renameContainedProjectPath(
        projectDir.value,
        sourcePath,
        targetPath
      );
      expect(renamed.isOk()).toBe(true);
      expect(existsSync(sourcePath)).toBe(false);
      expect(readFileSync(targetPath, 'utf8')).toBe(
        'export const before = true;\n'
      );
      expect(existsSync(outsidePath)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
