import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Result } from '@ontrails/core';
import { ValidationError, validateInput } from '@ontrails/core';

import { addTrail } from '../trails/add-trail.js';

const repoTempDir = (): string =>
  join(
    resolve(import.meta.dir, '../..'),
    '.tmp-tests',
    `add-trail-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const expectValidationError = (
  result: Result<unknown, Error>
): ValidationError => {
  if (result.isOk()) {
    throw new Error('Expected validation error');
  }
  expect(result.error).toBeInstanceOf(ValidationError);
  return result.error as ValidationError;
};

const readGeneratedFile = (dir: string, relativePath: string): string => {
  const filePath = join(dir, relativePath);
  expect(existsSync(filePath)).toBe(true);
  return readFileSync(filePath, 'utf8');
};

const assertGeneratedScaffold = (dir: string): void => {
  const trailSource = readGeneratedFile(dir, 'src/trails/entity-prepare.ts');
  const testSource = readGeneratedFile(dir, '__tests__/entity-prepare.test.ts');

  expect(trailSource).toContain('description: "Prepare an entity for export"');
  expect(trailSource).toContain('name: "Prepare a draft entity"');
  expect(trailSource).toContain(
    'expected: { message: "entity.prepare completed" }'
  );
  expect(testSource).toContain('description: "Prepare a draft entity"');
  expect(testSource).toContain(
    'expectValue: { message: "entity.prepare completed" }'
  );
  expect(trailSource).not.toContain('TODO');
  expect(testSource).not.toContain('TODO');
};

describe('add.trail', () => {
  test('requires authored description and example metadata', () => {
    const error = expectValidationError(
      validateInput(addTrail.input, {
        id: 'entity.prepare',
        intent: 'write',
      })
    );

    expect(error.message).toContain('description');
    expect(error.message).toContain('exampleName');
  });

  test('writes starter files without TODO placeholders', async () => {
    const dir = repoTempDir();

    try {
      mkdirSync(dir, { recursive: true });

      const result = expectOk(
        await addTrail.blaze(
          {
            description: 'Prepare an entity for export',
            exampleName: 'Prepare a draft entity',
            id: 'entity.prepare',
            intent: 'write',
          },
          { cwd: dir } as never
        )
      );

      expect(result.created).toEqual([
        'src/trails/entity-prepare.ts',
        '__tests__/entity-prepare.test.ts',
      ]);
      assertGeneratedScaffold(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
