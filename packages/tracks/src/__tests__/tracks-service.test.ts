import { describe, expect, test } from 'bun:test';

import { DEFAULT_SAMPLING } from '../sampling.js';
import type { TracksState } from '../registry.js';
import { tracksService } from '../tracks-service.js';

describe('tracksService', () => {
  test('has correct id', () => {
    expect(tracksService.id).toBe('tracks');
  });

  test('has service kind', () => {
    expect(tracksService.kind).toBe('service');
  });

  test('has infrastructure metadata', () => {
    expect(tracksService.metadata).toEqual({ category: 'infrastructure' });
  });

  describe('mock', () => {
    test('returns TracksState with default sampling', () => {
      const value = tracksService.mock?.() as TracksState;
      expect(value.active).toBe(true);
      expect(value.sampling).toEqual(DEFAULT_SAMPLING);
      expect(value.store).toBeUndefined();
    });
  });

  describe('create', () => {
    test('returns Result.ok with default TracksState when no state registered', () => {
      const ctx = {
        config: undefined,
        cwd: '/tmp',
        env: {},
        workspaceRoot: '/tmp',
      };
      const result = tracksService.create(ctx);
      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as TracksState;
      expect(value.active).toBe(true);
      expect(value.sampling).toEqual(DEFAULT_SAMPLING);
      expect(value.store).toBeUndefined();
    });
  });
});
