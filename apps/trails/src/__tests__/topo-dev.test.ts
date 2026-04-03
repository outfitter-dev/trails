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
import { createDevStore } from '@ontrails/tracker';

import { devCleanTrail } from '../trails/dev-clean.js';
import { devResetTrail } from '../trails/dev-reset.js';
import { devStatsTrail } from '../trails/dev-stats.js';
import { topoExportTrail } from '../trails/topo-export.js';
import { topoHistoryTrail } from '../trails/topo-history.js';
import { topoPinTrail } from '../trails/topo-pin.js';
import { topoShowTrail } from '../trails/topo-show.js';
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

const writeAppFixture = (dir: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, provision, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  blaze: async (input) => Result.ok({ message: \`Hello, \${input.name ?? 'world'}!\` }),
  crosses: ['goodbye'],
  examples: [{ input: {}, name: 'Default greeting' }],
  input: z.object({ name: z.string().optional() }),
  intent: 'read',
  output: z.object({ message: z.string() }),
  provisions: [
    provision('db.main', {
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

const [dbMain] = hello.provisions;
if (!dbMain) {
  throw new Error('expected hello to declare db.main');
}

export const app = topo('fixture-app', { dbMain, goodbye, hello });
`
  );
};

describe('topo and dev trails', () => {
  test('topo surfaces current summary, detail, and export/verify flow', async () => {
    const dir = repoTempDir();

    try {
      writeAppFixture(dir);

      const summary = expectOk(
        await topoTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(summary.app.name).toBe('fixture-app');
      expect(summary.list.count).toBe(2);
      expect(summary.list.provisionCount).toBe(1);
      expect(summary.lockExists).toBe(false);

      const detail = expectOk(
        await topoShowTrail.blaze({ ...moduleInput, id: 'hello' }, {
          cwd: dir,
        } as never)
      );
      expect(detail.id).toBe('hello');
      expect(detail.provisions).toEqual(['db.main']);

      const exportResult = expectOk(
        await topoExportTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(exportResult.hash).toHaveLength(64);
      expect(existsSync(join(dir, '.trails', '_trailhead.json'))).toBe(true);
      expect(existsSync(join(dir, '.trails', 'trails.lock'))).toBe(true);

      const verifyResult = expectOk(
        await topoVerifyTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(verifyResult.stale).toBe(false);

      writeFileSync(join(dir, '.trails', 'trails.lock'), 'stale\n');
      const verifyError = expectErr(
        await topoVerifyTrail.blaze(moduleInput, { cwd: dir } as never)
      );
      expect(verifyError.message).toContain('trails.lock is stale');
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
      expect(firstPin.pin.name).toBe('before-auth');

      await topoExportTrail.blaze(moduleInput, { cwd: dir } as never);
      await topoExportTrail.blaze(moduleInput, { cwd: dir } as never);

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
      expect(history.pinCount).toBe(1);
      expect(history.saveCount).toBeGreaterThanOrEqual(3);

      const stats = expectOk(
        await devStatsTrail.blaze({}, { cwd: dir } as never)
      );
      expect(stats.topo.pinCount).toBe(1);
      expect(stats.tracker.recordCount).toBe(2);

      const cleanPreview = expectOk(
        await devCleanTrail.blaze({ dryRun: true, saves: 0, trackAgeMs: 0 }, {
          cwd: dir,
        } as never)
      );
      expect(cleanPreview.dryRun).toBe(true);
      expect(cleanPreview.removed.topoSaves).toBeGreaterThanOrEqual(2);
      expect(cleanPreview.removed.trackRecords).toBe(2);

      const cleanResult = expectOk(
        await devCleanTrail.blaze(
          { dryRun: false, saves: 0, trackAgeMs: 0, yes: true },
          { cwd: dir } as never
        )
      );
      expect(cleanResult.removed.trackRecords).toBe(2);
      expect(cleanResult.remaining.pinCount).toBe(1);

      const unpinPreview = expectOk(
        await topoUnpinTrail.blaze({ dryRun: true, name: 'before-auth' }, {
          cwd: dir,
        } as never)
      );
      expect(unpinPreview.dryRun).toBe(true);
      expect(unpinPreview.pin?.name).toBe('before-auth');

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
      expect(preview.removed.topoSaves).toBe(0);
      expect(preview.removed.trackRecords).toBe(0);
      expect(existsSync(join(dir, '.trails', 'trails.db'))).toBe(false);

      const applied = expectOk(
        await devCleanTrail.blaze({ dryRun: false, yes: true }, {
          cwd: dir,
        } as never)
      );
      expect(applied.dryRun).toBe(false);
      expect(applied.removed.topoSaves).toBe(0);
      expect(applied.removed.trackRecords).toBe(0);
      expect(existsSync(join(dir, '.trails', 'trails.db'))).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
