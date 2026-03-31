import { describe, expect, test } from 'bun:test';

import { DEFAULT_SAMPLING } from '../sampling.js';
import type { CrumbsState } from '../registry.js';
import { crumbsService } from '../crumbs-service.js';

describe('crumbsService', () => {
  test('has correct id', () => {
    expect(crumbsService.id).toBe('crumbs');
  });

  test('has service kind', () => {
    expect(crumbsService.kind).toBe('service');
  });

  test('has infrastructure metadata', () => {
    expect(crumbsService.metadata).toEqual({ category: 'infrastructure' });
  });

  describe('mock', () => {
    test('returns CrumbsState with default sampling', () => {
      const value = crumbsService.mock?.() as CrumbsState;
      expect(value.active).toBe(true);
      expect(value.sampling).toEqual(DEFAULT_SAMPLING);
      expect(value.store).toBeUndefined();
    });
  });

  describe('create', () => {
    test('returns Result.ok with default CrumbsState when no state registered', () => {
      const ctx = {
        config: undefined,
        cwd: '/tmp',
        env: {},
        workspaceRoot: '/tmp',
      };
      const result = crumbsService.create(ctx);
      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as CrumbsState;
      expect(value.active).toBe(true);
      expect(value.sampling).toEqual(DEFAULT_SAMPLING);
      expect(value.store).toBeUndefined();
    });
  });
});
