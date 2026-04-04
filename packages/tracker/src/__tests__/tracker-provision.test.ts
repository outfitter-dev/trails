import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_SAMPLING } from '../sampling.js';
import { createDevStore } from '../stores/dev.js';
import type { TrackerState } from '../tracker-state.js';
import { clearTrackerState, registerTrackerState } from '../tracker-state.js';
import { trackerProvision } from '../tracker-provision.js';

describe('trackerProvision', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    clearTrackerState();
    if (tmpDir) {
      rmSync(tmpDir, { force: true, recursive: true });
      tmpDir = undefined;
    }
  });

  test('has correct id', () => {
    expect(trackerProvision.id).toBe('tracker');
  });

  test('has provision kind', () => {
    expect(trackerProvision.kind).toBe('provision');
  });

  test('has infrastructure meta', () => {
    expect(trackerProvision.meta).toEqual({ category: 'infrastructure' });
  });

  describe('mock', () => {
    test('returns TrackerState with default sampling', () => {
      const value = trackerProvision.mock?.() as TrackerState;
      expect(value.active).toBe(true);
      expect(value.sampling).toEqual(DEFAULT_SAMPLING);
      expect(value.store).toBeUndefined();
    });
  });

  describe('create', () => {
    test('returns Result.ok with default TrackerState when no state registered', () => {
      const ctx = {
        config: undefined,
        cwd: '/tmp',
        env: {},
        workspaceRoot: '/tmp',
      };
      const result = trackerProvision.create(ctx);
      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as TrackerState;
      expect(value.active).toBe(true);
      expect(value.sampling).toEqual(DEFAULT_SAMPLING);
      expect(value.store).toBeUndefined();
    });

    test('wraps a registered writable store with a read-only query surface', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'tracker-provision-'));
      const store = createDevStore({ path: join(tmpDir, 'tracker.db') });
      registerTrackerState({
        active: true,
        sampling: DEFAULT_SAMPLING,
        store,
      });

      const ctx = {
        config: undefined,
        cwd: tmpDir,
        env: {},
        workspaceRoot: tmpDir,
      };
      const result = trackerProvision.create(ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as TrackerState;
      expect(value.store).toBeDefined();
      expect('write' in (value.store as object)).toBe(false);
      value.store?.close();
    });
  });
});
