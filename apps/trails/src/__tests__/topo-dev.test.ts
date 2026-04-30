/* oxlint-disable max-statements */

import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { Result } from '@ontrails/core';
import { openReadTrailsDb } from '@ontrails/core/internal/trails-db';
import { createDevStore } from '@ontrails/tracing';

import { devCleanTrail } from '../trails/dev-clean.js';
import { devResetTrail } from '../trails/dev-reset.js';
import { devStatsTrail } from '../trails/dev-stats.js';
import { guideTrail } from '../trails/guide.js';
import {
  surveyBriefTrail,
  surveyTrail,
  surveyTrailDetailTrail,
} from '../trails/survey.js';
import { topoCompileTrail } from '../trails/topo-compile.js';
import { topoHistoryTrail } from '../trails/topo-history.js';
import { topoPinTrail } from '../trails/topo-pin.js';
import { topoTrail } from '../trails/topo.js';
import { topoUnpinTrail } from '../trails/topo-unpin.js';
import { topoVerifyTrail } from '../trails/topo-verify.js';

const repoTempDir = (): string =>
  join(
    resolve(import.meta.dir, '../..'),
    '.tmp-tests',
    `topo-dev-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

const moduleInput = { module: './src/app.ts' } as const;

const countTopoSnapshots = (rootDir: string): number => {
  const db = openReadTrailsDb({ rootDir });
  try {
    return (
      db
        .query<{ count: number }, []>(
          'SELECT COUNT(*) as count FROM topo_snapshots'
        )
        .get()?.count ?? 0
    );
  } finally {
    db.close();
  }
};

const writeAppFixture = (
  dir: string,
  options?: { readonly includeAuthTrail?: boolean }
): void => {
  const authTrail = options?.includeAuthTrail
    ? `
const authCheck = trail('auth.check', {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});
`
    : '';
  const topoMembers = options?.includeAuthTrail
    ? 'authCheck, dbMain, goodbye, hello'
    : 'dbMain, goodbye, hello';
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, resource, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  blaze: async (input) => Result.ok({ message: \`Hello, \${input.name ?? 'world'}!\` }),
  crosses: ['goodbye'],
  examples: [{ input: {}, name: 'Default greeting' }],
  input: z.object({ name: z.string().optional() }),
  intent: 'read',
  output: z.object({ message: z.string() }),
  resources: [
    resource('db.main', {
      create: () => Result.ok({ source: 'factory' }),
    }),
  ],
});

const goodbye = trail('goodbye', {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'write',
  output: z.object({ ok: z.boolean() }),
});

const [dbMain] = hello.resources;
if (!dbMain) {
  throw new Error('expected hello to declare db.main');
}

${authTrail}
export const app = topo('fixture-app', { ${topoMembers} });
`
  );
};

describe('topo and dev trails', () => {
  test('topo surfaces current summary, detail, and compile/verify flow', async () => {
    const dir = repoTempDir();

    try {
      writeAppFixture(dir);

      const summary = expectOk(
        await topoTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(summary.app.name).toBe('fixture-app');
      expect(summary.list.count).toBe(2);
      expect(summary.list.resourceCount).toBe(1);
      expect(summary.lockExists).toBe(false);

      const detail = expectOk(
        await surveyTrailDetailTrail.blaze({ ...moduleInput, id: 'hello' }, {
          cwd: dir,
        } as never)
      );
      expect(detail.id).toBe('hello');
      expect(detail.kind).toBe('trail');
      expect(detail.resources).toEqual(['db.main']);
      expect(surveyTrailDetailTrail.output.safeParse(detail).success).toBe(
        true
      );

      const compileResult = expectOk(
        await topoCompileTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      const snapshotCountAfterExport = countTopoSnapshots(dir);
      expect(compileResult.hash).toHaveLength(64);
      expect(existsSync(join(dir, '.trails', '_surface.json'))).toBe(true);
      expect(existsSync(join(dir, '.trails', 'trails.lock'))).toBe(true);
      expect(
        JSON.parse(readFileSync(join(dir, '.trails', 'trails.lock'), 'utf8'))
      ).toMatchObject({
        hash: compileResult.hash,
        version: 1,
      });

      const summaryAfterExport = expectOk(
        await topoTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(summaryAfterExport.lockExists).toBe(true);

      const verifyResult = expectOk(
        await topoVerifyTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(verifyResult.stale).toBe(false);
      expect(countTopoSnapshots(dir)).toBe(snapshotCountAfterExport);

      writeAppFixture(dir, { includeAuthTrail: true });
      const currentSummary = expectOk(
        await topoTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(currentSummary.list.count).toBe(3);
      expect(currentSummary.list.entries.map((entry) => entry.id)).toContain(
        'auth.check'
      );

      const driftError = expectErr(
        await topoVerifyTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(driftError.message).toContain('trails.lock is stale');
      expect(countTopoSnapshots(dir)).toBe(snapshotCountAfterExport);

      writeFileSync(join(dir, '.trails', 'trails.lock'), 'stale\n');
      const verifyError = expectErr(
        await topoVerifyTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(verifyError.message).toContain('trails.lock is stale');
      expect(countTopoSnapshots(dir)).toBe(snapshotCountAfterExport);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('survey and guide read current topo state through the shared topo store', async () => {
    const dir = repoTempDir();

    try {
      writeAppFixture(dir);

      const surveyList = expectOk(
        await surveyTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );
      expect(surveyList).toMatchObject({
        count: 2,
        mode: 'overview',
        resourceCount: 1,
      });

      const surveyBrief = expectOk(
        await surveyBriefTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );
      expect(surveyBrief).toMatchObject({
        features: {
          examples: true,
          outputSchemas: true,
          resources: true,
        },
        name: 'fixture-app',
        trails: 2,
      });

      const surveyDetail = expectOk(
        await surveyTrail.blaze({ id: 'hello', module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );
      expect(surveyDetail).toMatchObject({
        matches: [
          {
            detail: {
              id: 'hello',
              resources: ['db.main'],
            },
            kind: 'trail',
          },
        ],
        mode: 'lookup',
      });

      const guideList = expectOk(
        await guideTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );
      expect(guideList).toEqual({
        entries: [
          {
            description: '(no description)',
            exampleCount: 0,
            id: 'goodbye',
            kind: 'trail',
          },
          {
            description: '(no description)',
            exampleCount: 1,
            id: 'hello',
            kind: 'trail',
          },
        ],
        mode: 'list',
      });

      const guideDetail = expectOk(
        await guideTrail.blaze({ module: './src/app.ts', trailId: 'hello' }, {
          cwd: dir,
        } as never)
      );
      expect(guideDetail).toMatchObject({
        detail: {
          description: null,
          examples: [
            {
              input: {},
              name: 'Default greeting',
            },
          ],
          id: 'hello',
          kind: 'trail',
        },
        mode: 'detail',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('pinning, history, unpinning, and dev maintenance work against shared trails.db', async () => {
    const dir = repoTempDir();

    try {
      writeAppFixture(dir);

      const firstPin = expectOk(
        await topoPinTrail.blaze({ ...moduleInput, name: 'before-auth' }, {
          cwd: dir,
        } as never)
      );
      expect(firstPin.snapshot.pinnedAs).toBe('before-auth');

      const firstCompile = expectOk(
        await topoCompileTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      const secondCompile = expectOk(
        await topoCompileTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(firstCompile.hash).toBe(secondCompile.hash);
      expect(
        JSON.parse(readFileSync(join(dir, '.trails', 'trails.lock'), 'utf8'))
      ).toMatchObject({
        hash: secondCompile.hash,
        version: 1,
      });

      const projectionDb = openReadTrailsDb({ rootDir: dir });
      try {
        const pinnedRows = projectionDb
          .query<{ count: number }, [string]>(
            'SELECT COUNT(*) as count FROM topo_trails WHERE snapshot_id = ?'
          )
          .get(firstPin.snapshot.id);
        const exportedRows = projectionDb
          .query<{ count: number }, [string]>(
            'SELECT COUNT(*) as count FROM topo_trails WHERE snapshot_id = ?'
          )
          .get(firstCompile.snapshot.id);
        const projectedSaves = projectionDb
          .query<{ count: number }, []>(
            'SELECT COUNT(DISTINCT snapshot_id) as count FROM topo_trails'
          )
          .get();
        const cachedSchemas = projectionDb
          .query<{ count: number }, []>(
            'SELECT COUNT(*) as count FROM topo_schemas'
          )
          .get();

        expect(pinnedRows?.count).toBe(2);
        expect(exportedRows?.count).toBe(2);
        expect(projectedSaves?.count).toBe(3);
        expect(cachedSchemas?.count).toBeGreaterThanOrEqual(9);
      } finally {
        projectionDb.close();
      }

      const store = createDevStore({ rootDir: dir });
      try {
        store.write({
          attrs: {},
          endedAt: Date.now() - 1000,
          id: 'track-1',
          kind: 'trail',
          name: 'hello',
          rootId: 'track-1',
          startedAt: Date.now() - 10_000,
          status: 'ok',
          traceId: 'trace-1',
          trailId: 'hello',
          trailhead: 'cli',
        });
        store.write({
          attrs: {},
          endedAt: Date.now() - 500,
          id: 'track-2',
          kind: 'trail',
          name: 'goodbye',
          rootId: 'track-2',
          startedAt: Date.now() - 20_000,
          status: 'err',
          traceId: 'trace-2',
          trailId: 'goodbye',
          trailhead: 'cli',
        });
      } finally {
        store.close();
      }

      const history = expectOk(
        await topoHistoryTrail.blaze({}, { cwd: dir } as never)
      );
      expect(history.pinnedCount).toBe(1);
      expect(history.snapshotCount).toBeGreaterThanOrEqual(3);
      expect(
        history.snapshots.some(
          (snapshot) => snapshot.id === firstPin.snapshot.id
        )
      ).toBe(true);
      expect(
        history.snapshots.some(
          (snapshot) => snapshot.id === secondCompile.snapshot.id
        )
      ).toBe(true);

      const stats = expectOk(
        await devStatsTrail.blaze({}, { cwd: dir } as never)
      );
      expect(stats.topo.pinnedCount).toBe(1);
      expect(stats.tracing.recordCount).toBe(2);

      const cleanPreview = expectOk(
        await devCleanTrail.blaze(
          { dryRun: true, snapshots: 0, traceAgeMs: 0 },
          {
            cwd: dir,
          } as never
        )
      );
      expect(cleanPreview.dryRun).toBe(true);
      expect(cleanPreview.removed.topoSnapshots).toBeGreaterThanOrEqual(2);
      expect(cleanPreview.removed.traceRecords).toBe(2);

      const cleanResult = expectOk(
        await devCleanTrail.blaze(
          { dryRun: false, snapshots: 0, traceAgeMs: 0, yes: true },
          { cwd: dir } as never
        )
      );
      expect(cleanResult.removed.traceRecords).toBe(2);
      expect(cleanResult.remaining.pinnedCount).toBe(1);

      const unpinPreview = expectOk(
        await topoUnpinTrail.blaze({ dryRun: true, name: 'before-auth' }, {
          cwd: dir,
        } as never)
      );
      expect(unpinPreview.dryRun).toBe(true);
      expect(unpinPreview.snapshot?.pinnedAs).toBe('before-auth');

      const unpinResult = expectOk(
        await topoUnpinTrail.blaze(
          { dryRun: false, name: 'before-auth', yes: true },
          { cwd: dir } as never
        )
      );
      expect(unpinResult.removed).toBe(true);

      const resetPreview = expectOk(
        await devResetTrail.blaze({ dryRun: true }, { cwd: dir } as never)
      );
      expect(resetPreview.dryRun).toBe(true);
      expect(resetPreview.removedFiles).toContain('.trails/trails.db');

      const resetResult = expectOk(
        await devResetTrail.blaze({ dryRun: false, yes: true }, {
          cwd: dir,
        } as never)
      );
      expect(resetResult.removedFiles).toContain('.trails/trails.db');
      expect(existsSync(join(dir, '.trails', 'trails.db'))).toBe(false);
      expect(
        readFileSync(join(dir, '.trails', 'trails.lock'), 'utf8').length
      ).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('dev clean stays side-effect free when no local state exists', async () => {
    const dir = repoTempDir();

    try {
      mkdirSync(dir, { recursive: true });

      const preview = expectOk(
        await devCleanTrail.blaze({ dryRun: true }, { cwd: dir } as never)
      );
      expect(preview.dryRun).toBe(true);
      expect(preview.removed.topoSnapshots).toBe(0);
      expect(preview.removed.traceRecords).toBe(0);
      expect(existsSync(join(dir, '.trails', 'trails.db'))).toBe(false);

      const applied = expectOk(
        await devCleanTrail.blaze({ dryRun: false, yes: true }, {
          cwd: dir,
        } as never)
      );
      expect(applied.dryRun).toBe(false);
      expect(applied.removed.topoSnapshots).toBe(0);
      expect(applied.removed.traceRecords).toBe(0);
      expect(existsSync(join(dir, '.trails', 'trails.db'))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
