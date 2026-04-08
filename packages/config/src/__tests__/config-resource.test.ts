import { afterEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { configProvision } from '../config-resource.js';
import type { ConfigState } from '../registry.js';
import { clearConfigState, registerConfigState } from '../registry.js';

/** Stub ProvisionContext for create calls. */
const stubSvcCtx = {
  config: undefined,
  cwd: '/tmp',
  env: {},
  workspaceRoot: '/tmp',
};

describe('configProvision', () => {
  afterEach(() => {
    clearConfigState();
  });

  describe('identity', () => {
    test('has id "config"', () => {
      expect(configProvision.id).toBe('config');
    });

    test('has kind "resource"', () => {
      expect(configProvision.kind).toBe('resource');
    });

    test('has infrastructure meta', () => {
      expect(configProvision.meta).toEqual({ category: 'infrastructure' });
    });

    test('has description', () => {
      expect(configProvision.description).toBeDefined();
    });
  });

  describe('mock', () => {
    test('returns a ConfigState with empty schema and resolved', () => {
      const value = configProvision.mock?.() as ConfigState;
      expect(value).toBeDefined();
      expect(value.resolved).toEqual({});
      expect(value.schema).toBeDefined();
    });
  });

  describe('create', () => {
    test('returns Result.ok with registered ConfigState', async () => {
      const schema = z.object({ port: z.number().default(3000) });
      const state: ConfigState = { resolved: { port: 3000 }, schema };
      registerConfigState(state);

      const result = await configProvision.create(stubSvcCtx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as ConfigState;
      expect(value.resolved).toEqual({ port: 3000 });
      expect(value.schema).toBe(schema);
    });

    test('includes optional layer data when present', async () => {
      const schema = z.object({ port: z.number() });
      const state: ConfigState = {
        base: { port: 8080 },
        local: { port: 3000 },
        resolved: { port: 3000 },
        schema,
      };
      registerConfigState(state);

      const result = await configProvision.create(stubSvcCtx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as ConfigState;
      expect(value.base).toEqual({ port: 8080 });
      expect(value.local).toEqual({ port: 3000 });
    });

    test('returns Result.err when no state is registered', async () => {
      const result = await configProvision.create(stubSvcCtx);

      expect(result.isErr()).toBe(true);
      expect(result.error.message).toContain('Config state not registered');
    });
  });
});
