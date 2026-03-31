import { afterEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { configService } from '../config-service.js';
import type { ConfigState } from '../registry.js';
import { clearConfigState, registerConfigState } from '../registry.js';

/** Stub ServiceContext for create calls. */
const stubSvcCtx = {
  config: undefined,
  cwd: '/tmp',
  env: {},
  workspaceRoot: '/tmp',
};

describe('configService', () => {
  afterEach(() => {
    clearConfigState();
  });

  describe('identity', () => {
    test('has id "config"', () => {
      expect(configService.id).toBe('config');
    });

    test('has kind "service"', () => {
      expect(configService.kind).toBe('service');
    });

    test('has infrastructure metadata', () => {
      expect(configService.metadata).toEqual({ category: 'infrastructure' });
    });

    test('has description', () => {
      expect(configService.description).toBeDefined();
    });
  });

  describe('mock', () => {
    test('returns a ConfigState with empty schema and resolved', () => {
      const value = configService.mock?.() as ConfigState;
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

      const result = await configService.create(stubSvcCtx);

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

      const result = await configService.create(stubSvcCtx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap() as ConfigState;
      expect(value.base).toEqual({ port: 8080 });
      expect(value.local).toEqual({ port: 3000 });
    });

    test('returns Result.err when no state is registered', async () => {
      const result = await configService.create(stubSvcCtx);

      expect(result.isErr()).toBe(true);
      expect(result.error.message).toContain('Config state not registered');
    });
  });
});
