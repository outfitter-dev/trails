import { describe, expect, test } from 'bun:test';

import { DEFAULT_SAMPLING } from '../sampling.js';
import type { TrackerState } from '../tracker-state.js';
import { trackerProvision } from '../tracker-provision.js';

describe('trackerProvision', () => {
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
  });
});
