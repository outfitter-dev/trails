import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openWriteTrailsDb } from '@ontrails/core';

import {
  createTopoSnapshot,
  ensureTopoSnapshotSchema,
  listTopoSnapshots,
  pinTopoSnapshot,
  pruneUnpinnedSnapshots,
} from '../internal/topo-snapshots.js';

describe('topo snapshot primitives', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = undefined;
    }
  });

  const makeRoot = (): string => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'topo-snapshots-'));
    return tmpRoot;
  };

  const seedHistory = (db: ReturnType<typeof openWriteTrailsDb>) => {
    ensureTopoSnapshotSchema(db);

    const pinned = createTopoSnapshot(db, {
      createdAt: '2026-04-01T00:00:00.000Z',
      gitDirty: false,
      gitSha: 'abc123',
      resourceCount: 2,
      signalCount: 1,
      trailCount: 3,
    });
    const disposable = createTopoSnapshot(db, {
      createdAt: '2026-04-02T00:00:00.000Z',
      gitDirty: true,
      gitSha: 'def456',
      resourceCount: 3,
      signalCount: 2,
      trailCount: 4,
    });

    return {
      disposable,
      pinned,
      pinnedSnapshot: pinTopoSnapshot(db, {
        id: pinned.id,
        name: 'before-auth',
      }),
    };
  };

  test('creates snapshots, pins them, and prunes only unpinned history', () => {
    const rootDir = makeRoot();
    const db = openWriteTrailsDb({ rootDir });

    try {
      const { disposable, pinned, pinnedSnapshot } = seedHistory(db);

      expect(pinnedSnapshot?.pinnedAs).toBe('before-auth');
      expect(
        listTopoSnapshots(db, { pinned: true }).map((snapshot) => snapshot.id)
      ).toEqual([pinned.id]);
      expect(listTopoSnapshots(db).map((snapshot) => snapshot.id)).toEqual([
        disposable.id,
        pinned.id,
      ]);

      expect(pruneUnpinnedSnapshots(db, { keep: 0 })).toBe(1);
      expect(listTopoSnapshots(db).map((snapshot) => snapshot.id)).toEqual([
        pinned.id,
      ]);
    } finally {
      db.close();
    }
  });
});
