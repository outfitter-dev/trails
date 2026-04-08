import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_SAMPLING } from '../sampling.js';
import { createDevStore } from '../stores/dev.js';
import type { TracingState } from '../tracing-state.js';
import { clearTracingState, registerTracingState } from '../tracing-state.js';
import { tracingResource } from '../tracing-resource.js';

describe('tracingResource', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    clearTracingState();
    if (tmpDir) {
      rmSync(tmpDir, { force: true, recursive: true });
      tmpDir = undefined;
    }
  });

  test('has correct id', () => {
    expect(tracingResource.id).toBe('tracing');
  });

  test('has resource kind', () => {
    expect(tracingResource.kind).toBe('resource');
  });

  test('has infrastructure meta', () => {
    expect(tracingResource.meta).toEqual({ category: 'infrastructure' });
  });

  describe('mock', () => {
    test('returns TracingState with default sampling', () => {
      const value = tracingResource.mock?.() as TracingState;
      expect(value.active).toBe(true);
      expect(value.sampling).toEqual(DEFAULT_SAMPLING);
      expect(value.store).toBeUndefined();
    });
  });

  describe('create', () => {
    test('returns Result.ok with default TracingState when no state registered', () => {
      const ctx = {
        config: undefined,
        cwd: '/tmp',
        env: {},
        workspaceRoot: '/tmp',
      };
      const result = tracingResource.create(ctx);
      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as TracingState;
      expect(value.active).toBe(true);
      expect(value.sampling).toEqual(DEFAULT_SAMPLING);
      expect(value.store).toBeUndefined();
    });

    test('wraps a registered writable store with a read-only query surface', () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'tracing-provision-'));
      const store = createDevStore({ path: join(tmpDir, 'tracing.db') });
      registerTracingState({
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
      const result = tracingResource.create(ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as TracingState;
      expect(value.store).toBeDefined();
      expect('write' in (value.store as object)).toBe(false);
      value.store?.close();
    });
  });
});
