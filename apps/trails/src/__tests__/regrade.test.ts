import { deriveCliCommands } from '@ontrails/cli';
import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { operatorApp } from '../app.js';
import { regradeTrail } from '../trails/regrade.js';

const makeTempDir = (): string =>
  mkdtempSync(join(tmpdir(), `trails-regrade-test-${Date.now()}-`));

const unwrapCommands = () => {
  const result = deriveCliCommands(operatorApp);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

describe('trails regrade', () => {
  test('projects regrade as a CLI command', () => {
    const commands = unwrapCommands();
    const command = commands.find(
      (candidate) => candidate.trail.id === 'regrade'
    );

    expect(command).toBeDefined();
    expect(command?.path).toEqual(['regrade']);
    expect(command?.trail.intent).toBe('write');
  });

  test('dry-runs safe downstream rewrites by default', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      const target = join(dir, 'src', 'play.ts');
      writeFileSync(
        target,
        'export const play = trail("play", { crosses: [] });\n'
      );

      const result = await regradeTrail.blaze({ rootDir: dir }, {
        cwd: dir,
        env: {},
      } as never);

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.rewritten).toBe(1);
      expect(result.value.apply).toBeUndefined();
      expect(readFileSync(target, 'utf8')).toContain('crosses');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('apply mode writes only safe downstream rewrites', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      const target = join(dir, 'src', 'play.ts');
      writeFileSync(
        target,
        'export const play = trail("play", { crosses: [] });\n'
      );

      const result = await regradeTrail.blaze({ apply: true, rootDir: dir }, {
        cwd: dir,
        env: {},
      } as never);

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.apply).toMatchObject({
        applied: 1,
        filesChanged: 1,
        review: 0,
      });
      expect(readFileSync(target, 'utf8')).toContain('composes');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('apply mode returns a Trails error when a rewrite cannot be written', async () => {
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      const target = join(dir, 'src', 'play.ts');
      writeFileSync(
        target,
        'export const play = trail("play", { crosses: [] });\n'
      );
      chmodSync(target, 0o444);

      const result = await regradeTrail.blaze({ apply: true, rootDir: dir }, {
        cwd: dir,
        env: {},
      } as never);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.constructor.name).toBe('InternalError');
      }
    } finally {
      chmodSync(join(dir, 'src', 'play.ts'), 0o644);
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
