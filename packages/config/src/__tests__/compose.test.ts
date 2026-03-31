import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { collectServiceConfigs } from '../compose.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('collectServiceConfigs', () => {
  test('extracts config schemas from services that declare them', () => {
    const dbSchema = z.object({ url: z.string().url() });
    const cacheSchema = z.object({ ttl: z.number() });

    const services = [
      { config: dbSchema, id: 'db.main' },
      { config: cacheSchema, id: 'cache.main' },
    ];

    const entries = collectServiceConfigs(services);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ schema: dbSchema, serviceId: 'db.main' });
    expect(entries[1]).toEqual({
      schema: cacheSchema,
      serviceId: 'cache.main',
    });
  });

  test('excludes services without config', () => {
    const schema = z.object({ url: z.string() });

    const services = [
      { config: schema, id: 'db.main' },
      { id: 'counter.main' },
      { config: undefined, id: 'logger.main' },
    ];

    const entries = collectServiceConfigs(services);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.serviceId).toBe('db.main');
  });

  test('returns empty array when no services have config', () => {
    const services = [{ id: 'counter.main' }, { id: 'logger.main' }];

    const entries = collectServiceConfigs(services);

    expect(entries).toEqual([]);
  });

  test('returns empty array for empty input', () => {
    const entries = collectServiceConfigs([]);

    expect(entries).toEqual([]);
  });
});
