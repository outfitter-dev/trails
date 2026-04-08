import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_SAMPLING } from '../sampling.js';
import { createDevStore } from '../stores/dev.js';
import type { TracingState } from '../tracing-state.js';
import { clearTracingState, registerTracingState } from '../tracing-state.js';
import { tracingProvision } from '../tracing-provision.js';

describe('tracingProvision', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    clearTracingState();
    if (tmpDir) {
      rmSync(tmpDir, { force: true, recursive: true });
      tmpDir = undefined;
    }
  });

  test('has correct id', () => {
    expect(tracingProvision.id).toBe('tracing');
  });

  test('has resource kind', () => {
    expect(tracingProvision.kind).toBe('resource');
  });

  test('has infrastructure meta', () => {
    expect(tracingProvision.meta).toEqual({ category: 'infrastructure' });
  });

  describe('mock', () => {
    test('returns TracingState with default sampling', () => {
      const value = tracingProvision.mock?.() as TracingState;
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
      const result = tracingProvision.create(ctx);
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
      const result = tracingProvision.create(ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as TracingState;
      expect(value.store).toBeDefined();
      expect('write' in (value.store as object)).toBe(false);
      value.store?.close();
    });
  });
});
