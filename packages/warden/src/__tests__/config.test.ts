import { describe, expect, test } from 'bun:test';
import { defineConfig } from '@ontrails/config';
import { z } from 'zod';

import { wardenConfigSchema } from '../config.js';

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
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      apps: ['demo', 'admin'],
      depth: 'project',
      drafts: 'exclude',
      failOn: 'warning',
      format: 'github',
      lock: 'cached',
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
      },
    });
  });
});
