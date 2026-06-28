import { describe, expect, test } from 'bun:test';
import { defineConfig } from '@ontrails/config';
import { z } from 'zod';

import { resolveWardenConfig, wardenConfigSchema } from '../config.js';

describe('wardenConfigSchema', () => {
  test('applies Warden defaults when the section is omitted', () => {
    const omittedSection: unknown = undefined;
    const result = wardenConfigSchema.safeParse(omittedSection);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      depth: 'all',
      drafts: 'include',
      failOn: 'error',
      format: 'summary',
      lock: 'auto',
      scope: {
        exclude: [],
      },
    });
  });

  test('validates every Sprint 1 config dimension', () => {
    const result = wardenConfigSchema.safeParse({
      apps: ['demo', 'admin'],
      depth: 'project',
      drafts: 'exclude',
      failOn: 'warning',
      format: 'github',
      lock: 'cached',
      scope: {
        exclude: ['.agents/notes/**', '.scratch/**'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      apps: ['demo', 'admin'],
      depth: 'project',
      drafts: 'exclude',
      failOn: 'warning',
      format: 'github',
      lock: 'cached',
      scope: {
        exclude: ['.agents/notes/**', '.scratch/**'],
      },
    });
  });

  test('rejects invalid enum values and unknown config keys', () => {
    const result = wardenConfigSchema.safeParse({
      depth: 'shallow',
      experimentalRuleOverrides: {},
      failOn: 'notice',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('depth');
      expect(paths).toContain('failOn');
      expect(
        result.error.issues.some((issue) => issue.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  test('composes into defineConfig without a Warden-specific helper', async () => {
    const config = defineConfig({
      base: {},
      schema: z.object({
        warden: wardenConfigSchema,
      }),
    });

    const result = await config.resolve({ env: { TRAILS_ENV: 'test' } });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      warden: {
        depth: 'all',
        drafts: 'include',
        failOn: 'error',
        format: 'summary',
        lock: 'auto',
        scope: {
          exclude: [],
        },
      },
    });
  });

  test('resolves config with CLI over env over config over defaults precedence', () => {
    const { diagnostics, effectiveConfig } = resolveWardenConfig({
      cli: { failOn: 'error', format: 'json' },
      config: { depth: 'source', failOn: 'warning', lock: 'cached' },
      defaults: { lock: 'skip' },
      env: {
        TRAILS_DEPTH: 'project',
        TRAILS_FAIL_ON: 'warning',
        TRAILS_FORMAT: 'github',
      },
    });

    expect(diagnostics).toEqual([]);
    expect(effectiveConfig).toEqual({
      depth: 'project',
      drafts: 'include',
      failOn: 'error',
      format: 'json',
      lock: 'cached',
      noLockMutation: false,
      scope: {
        exclude: [],
      },
    });
  });

  test('surfaces invalid environment config as diagnostics', () => {
    const { diagnostics, effectiveConfig } = resolveWardenConfig({
      env: {
        TRAILS_DEPTH: 'shallow',
      },
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('warden-config');
    expect(diagnostics[0]?.message).toContain('Invalid environment');
    expect(effectiveConfig.depth).toBe('all');
  });

  test('carries no-lock-mutation as invocation state, not config schema', () => {
    const { diagnostics, effectiveConfig } = resolveWardenConfig({
      cli: {
        noLockMutation: true,
      },
    });

    expect(diagnostics).toEqual([]);
    expect(effectiveConfig.noLockMutation).toBe(true);
  });
});
