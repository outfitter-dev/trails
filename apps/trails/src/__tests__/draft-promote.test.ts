import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

import type { Result } from '@ontrails/core';
import { ValidationError } from '@ontrails/core';

import { draftPromoteTrail } from '../trails/draft-promote.js';

const repoTempDir = (): string =>
  join(
    resolve(import.meta.dir, '../..'),
    '.tmp-tests',
    `draft-promote-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const expectErr = <E extends Error>(result: Result<unknown, E>): E => {
  if (result.isOk()) {
    throw new Error('expected result to be an error');
  }
  return result.error;
};

const writeDraftPromoteFixture = (dir: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });

  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { topo } from '@ontrails/core';
import { draftPrepare } from './_draft.prepare.js';
import { exportTrail } from './export.js';

export const app = topo('draft-test', { draftPrepare, exportTrail });
`
  );

  writeFileSync(
    join(dir, 'src', '_draft.prepare.ts'),
    `import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const draftPrepare = trail('_draft.entity.prepare', {
  blaze: async () => Result.ok({ ready: true }),
  input: z.object({}),
  output: z.object({ ready: z.boolean() }),
});
`
  );

  writeFileSync(
    join(dir, 'src', 'export.ts'),
    `import { Result, trail } from '@ontrails/core';
import { draftPrepare } from './_draft.prepare.js';
import { z } from 'zod';

export const dependencies = [draftPrepare];

export const exportTrail = trail('entity.export', {
  blaze: async () => Result.ok({ exported: true }),
  crosses: ['_draft.entity.prepare'],
  input: z.object({}),
  output: z.object({ exported: z.boolean() }),
});
`
  );
};

const expectDraftPromoteResults = (dir: string): void => {
  expect(existsSync(join(dir, 'src', '_draft.prepare.ts'))).toBe(false);
  expect(existsSync(join(dir, 'src', 'prepare.ts'))).toBe(true);
  expect(readFileSync(join(dir, 'src', 'prepare.ts'), 'utf8')).toContain(
    "trail('entity.prepare'"
  );
  expect(readFileSync(join(dir, 'src', 'export.ts'), 'utf8')).toContain(
    "crosses: ['entity.prepare']"
  );
  expect(readFileSync(join(dir, 'src', 'export.ts'), 'utf8')).toContain(
    "from './prepare.js'"
  );
  expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toContain(
    "from './prepare.js'"
  );
};

describe('draft.promote', () => {
  test('promotes draft ids, renames files, and updates imports', async () => {
    const dir = repoTempDir();

    try {
      writeDraftPromoteFixture(dir);

      const result = expectOk(
        await draftPromoteTrail.blaze(
          {
            fromId: '_draft.entity.prepare',
            renameFiles: true,
            rootDir: dir,
            toId: 'entity.prepare',
          },
          { cwd: dir } as never
        )
      );

      expect(result.promotedEstablished).toBe(true);
      expect(result.remainingDraftIds).toEqual([]);
      expect(result.updatedFiles).toEqual(
        expect.arrayContaining(['src/app.ts', 'src/export.ts'])
      );
      expect(result.renamedFiles).toEqual([
        {
          from: 'src/_draft.prepare.ts',
          to: 'src/prepare.ts',
        },
      ]);
      expectDraftPromoteResults(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('plans promotion rewrites without touching disk and applies the same operations', async () => {
    const dir = repoTempDir();

    try {
      writeDraftPromoteFixture(dir);
      const originalDraft = readFileSync(
        join(dir, 'src', '_draft.prepare.ts'),
        'utf8'
      );
      const originalApp = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');

      const dryRun = expectOk(
        await draftPromoteTrail.blaze(
          {
            dryRun: true,
            fromId: '_draft.entity.prepare',
            renameFiles: true,
            rootDir: dir,
            toId: 'entity.prepare',
          },
          { cwd: dir } as never
        )
      );

      expect(dryRun.dryRun).toBe(true);
      expect(dryRun.promotedEstablished).toBe(false);
      expect(dryRun.plannedOperations).toEqual(
        expect.arrayContaining([
          { kind: 'write', path: 'src/_draft.prepare.ts' },
          {
            from: 'src/_draft.prepare.ts',
            kind: 'rename',
            to: 'src/prepare.ts',
          },
          { kind: 'write', path: 'src/app.ts' },
        ])
      );
      expect(
        dryRun.plannedOperations.filter(
          (operation) =>
            operation.kind === 'write' && operation.path === 'src/export.ts'
        )
      ).toHaveLength(1);
      expect(existsSync(join(dir, 'src', '_draft.prepare.ts'))).toBe(true);
      expect(existsSync(join(dir, 'src', 'prepare.ts'))).toBe(false);
      expect(readFileSync(join(dir, 'src', '_draft.prepare.ts'), 'utf8')).toBe(
        originalDraft
      );
      expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toBe(
        originalApp
      );

      const applied = expectOk(
        await draftPromoteTrail.blaze(
          {
            fromId: '_draft.entity.prepare',
            renameFiles: true,
            rootDir: dir,
            toId: 'entity.prepare',
          },
          { cwd: dir } as never
        )
      );

      expect(applied.dryRun).toBe(false);
      expect(applied.plannedOperations).toEqual(dryRun.plannedOperations);
      expect(applied.promotedEstablished).toBe(true);
      expectDraftPromoteResults(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('promotes from a relative root without duplicating path containment', async () => {
    const dir = repoTempDir();

    try {
      writeDraftPromoteFixture(dir);

      const result = expectOk(
        await draftPromoteTrail.blaze(
          {
            fromId: '_draft.entity.prepare',
            renameFiles: true,
            rootDir: relative(process.cwd(), dir),
            toId: 'entity.prepare',
          },
          { cwd: process.cwd() } as never
        )
      );

      expect(result.promotedEstablished).toBe(true);
      expect(result.renamedFiles).toEqual([
        {
          from: 'src/_draft.prepare.ts',
          to: 'src/prepare.ts',
        },
      ]);
      expectDraftPromoteResults(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('promotes a relative root from the context cwd', async () => {
    const workspaceDir = repoTempDir();
    const dir = join(workspaceDir, 'nested-project');

    try {
      writeDraftPromoteFixture(dir);

      const result = expectOk(
        await draftPromoteTrail.blaze(
          {
            fromId: '_draft.entity.prepare',
            renameFiles: true,
            rootDir: 'nested-project',
            toId: 'entity.prepare',
          },
          { cwd: workspaceDir } as never
        )
      );

      expect(result.promotedEstablished).toBe(true);
      expect(result.renamedFiles).toEqual([
        {
          from: 'src/_draft.prepare.ts',
          to: 'src/prepare.ts',
        },
      ]);
      expectDraftPromoteResults(dir);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test('promotes an absolute root without context cwd', async () => {
    const dir = repoTempDir();

    try {
      writeDraftPromoteFixture(dir);

      const result = expectOk(
        await draftPromoteTrail.blaze(
          {
            fromId: '_draft.entity.prepare',
            renameFiles: true,
            rootDir: dir,
            toId: 'entity.prepare',
          },
          {} as never
        )
      );

      expect(result.promotedEstablished).toBe(true);
      expect(result.renamedFiles).toEqual([
        {
          from: 'src/_draft.prepare.ts',
          to: 'src/prepare.ts',
        },
      ]);
      expectDraftPromoteResults(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('returns ValidationError when rootDir does not exist', async () => {
    const error = expectErr(
      await draftPromoteTrail.blaze(
        {
          fromId: '_draft.entity.prepare',
          renameFiles: true,
          rootDir: join(repoTempDir(), 'missing'),
          toId: 'entity.prepare',
        },
        { cwd: process.cwd() } as never
      )
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toContain('rootDir does not exist');
  });

  test('returns ValidationError when a source file cannot be read', async () => {
    const dir = repoTempDir();

    try {
      writeDraftPromoteFixture(dir);
      chmodSync(join(dir, 'src', 'export.ts'), 0o000);

      const error = expectErr(
        await draftPromoteTrail.blaze(
          {
            fromId: '_draft.entity.prepare',
            renameFiles: true,
            rootDir: dir,
            toId: 'entity.prepare',
          },
          { cwd: dir } as never
        )
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain('Cannot read source file');
      expect(error.message).toContain('export.ts');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
