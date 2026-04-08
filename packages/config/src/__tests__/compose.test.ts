import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { collectProvisionConfigs } from '../compose.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('collectProvisionConfigs', () => {
  test('extracts config schemas from resources that declare them', () => {
    const dbSchema = z.object({ url: z.string().url() });
    const cacheSchema = z.object({ ttl: z.number() });

    const resources = [
      { config: dbSchema, id: 'db.main' },
      { config: cacheSchema, id: 'cache.main' },
    ];

    const entries = collectResourceConfigs(resources);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ provisionId: 'db.main', schema: dbSchema });
    expect(entries[1]).toEqual({
      provisionId: 'cache.main',
      schema: cacheSchema,
    });
  });

  test('excludes resources without config', () => {
    const schema = z.object({ url: z.string() });

    const resources = [
      { config: schema, id: 'db.main' },
      { id: 'counter.main' },
      { config: undefined, id: 'logger.main' },
    ];

    const entries = collectResourceConfigs(resources);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.provisionId).toBe('db.main');
  });

  test('returns empty array when no resources have config', () => {
    const resources = [{ id: 'counter.main' }, { id: 'logger.main' }];

    const entries = collectResourceConfigs(resources);

    expect(entries).toEqual([]);
  });

  test('returns empty array for empty input', () => {
    const entries = collectProvisionConfigs([]);

    expect(entries).toEqual([]);
  });
});
