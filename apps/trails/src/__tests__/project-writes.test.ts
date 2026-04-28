import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PermissionError, ValidationError } from '@ontrails/core';

import {
  resolveProjectDir,
  validateProjectName,
  validateTrailId,
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
});
