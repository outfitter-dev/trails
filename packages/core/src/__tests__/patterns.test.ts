import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import {
  paginationFields,
  paginatedOutput,
  bulkOutput,
  timestampFields,
  dateRangeFields,
  sortFields,
  statusFields,
  changeOutput,
  progressFields,
} from '../patterns/index.js';

// ---------------------------------------------------------------------------
// paginationFields
// ---------------------------------------------------------------------------

describe('paginationFields', () => {
  const schema = paginationFields();

  test('applies defaults for empty input', () => {
    const result = schema.parse({});
    expect(result).toEqual({ limit: 20, offset: 0 });
  });

  test('accepts explicit values', () => {
    const result = schema.parse({ cursor: 'abc', limit: 50, offset: 10 });
    expect(result).toEqual({ cursor: 'abc', limit: 50, offset: 10 });
  });

  test('rejects non-number limit', () => {
    expect(() => schema.parse({ limit: 'ten' })).toThrow();
  });

  test('rejects non-string cursor', () => {
    expect(() => schema.parse({ cursor: 123 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// paginatedOutput
// ---------------------------------------------------------------------------

describe('paginatedOutput', () => {
  const schema = paginatedOutput(z.string());

  test('parses valid paginated data', () => {
    const data = {
      hasMore: true,
      items: ['a', 'b'],
      nextCursor: 'x',
      total: 10,
    };
    expect(schema.parse(data)).toEqual(data);
  });

  test('allows missing nextCursor', () => {
    const data = { hasMore: false, items: [], total: 0 };
    expect(schema.parse(data)).toEqual(data);
  });

  test('rejects wrong item type', () => {
    expect(() =>
      schema.parse({ hasMore: false, items: [1], total: 1 })
    ).toThrow();
  });

  test('rejects missing total', () => {
    expect(() => schema.parse({ hasMore: false, items: [] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// bulkOutput
// ---------------------------------------------------------------------------

describe('bulkOutput', () => {
  const schema = bulkOutput(z.object({ id: z.number() }));

  test('parses valid bulk result', () => {
    const data = {
      failed: 0,
      items: [{ id: 1 }, { id: 2 }],
      succeeded: 2,
    };
    expect(schema.parse(data)).toEqual(data);
  });

  test('parses bulk result with errors', () => {
    const data = {
      errors: [{ index: 1, message: 'duplicate' }],
      failed: 1,
      items: [{ id: 1 }],
      succeeded: 1,
    };
    expect(schema.parse(data)).toEqual(data);
  });

  test('rejects missing succeeded field', () => {
    expect(() => schema.parse({ failed: 0, items: [] })).toThrow();
  });

  test('rejects invalid error shape', () => {
    expect(() =>
      schema.parse({
        errors: [{ bad: true }],
        failed: 0,
        items: [],
        succeeded: 0,
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// timestampFields
// ---------------------------------------------------------------------------

describe('timestampFields', () => {
  const schema = timestampFields();

  test('parses valid timestamps', () => {
    const data = {
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-06-01T00:00:00Z',
    };
    expect(schema.parse(data)).toEqual(data);
  });

  test('rejects missing createdAt', () => {
    expect(() => schema.parse({ updatedAt: '2024-01-01' })).toThrow();
  });

  test('rejects non-string values', () => {
    expect(() => schema.parse({ createdAt: 123, updatedAt: 456 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// dateRangeFields
// ---------------------------------------------------------------------------

describe('dateRangeFields', () => {
  const schema = dateRangeFields();

  test('parses empty object (both optional)', () => {
    expect(schema.parse({})).toEqual({});
  });

  test('parses with both fields', () => {
    const data = { since: '2024-01-01', until: '2024-12-31' };
    expect(schema.parse(data)).toEqual(data);
  });

  test('parses with only since', () => {
    expect(schema.parse({ since: '2024-01-01' })).toEqual({
      since: '2024-01-01',
    });
  });

  test('rejects non-string values', () => {
    expect(() => schema.parse({ since: 42 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// sortFields
// ---------------------------------------------------------------------------

describe('sortFields', () => {
  const schema = sortFields(['name', 'createdAt', 'updatedAt']);

  test('applies default sortOrder', () => {
    const result = schema.parse({});
    expect(result).toEqual({ sortOrder: 'asc' });
  });

  test('accepts valid sortBy and sortOrder', () => {
    const result = schema.parse({ sortBy: 'name', sortOrder: 'desc' });
    expect(result).toEqual({ sortBy: 'name', sortOrder: 'desc' });
  });

  test('rejects sortBy not in allowed list', () => {
    expect(() => schema.parse({ sortBy: 'email' })).toThrow();
  });

  test('rejects invalid sortOrder', () => {
    expect(() => schema.parse({ sortOrder: 'up' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// statusFields
// ---------------------------------------------------------------------------

describe('statusFields', () => {
  const schema = statusFields();

  test('parses each valid status', () => {
    for (const s of [
      'pending',
      'running',
      'completed',
      'failed',
      'cancelled',
    ] as const) {
      expect(schema.parse({ status: s })).toEqual({ status: s });
    }
  });

  test('rejects invalid status', () => {
    expect(() => schema.parse({ status: 'unknown' })).toThrow();
  });

  test('rejects missing status', () => {
    expect(() => schema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// changeOutput
// ---------------------------------------------------------------------------

describe('changeOutput', () => {
  const schema = changeOutput(z.object({ name: z.string() }));

  test('parses with both before and after', () => {
    const data = { after: { name: 'new' }, before: { name: 'old' } };
    expect(schema.parse(data)).toEqual(data);
  });

  test('parses with only after (before is optional)', () => {
    const data = { after: { name: 'created' } };
    expect(schema.parse(data)).toEqual(data);
  });

  test('rejects missing after', () => {
    expect(() => schema.parse({ before: { name: 'old' } })).toThrow();
  });

  test('rejects invalid schema shape', () => {
    expect(() => schema.parse({ after: { name: 123 } })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// progressFields
// ---------------------------------------------------------------------------

describe('progressFields', () => {
  const schema = progressFields();

  test('parses valid progress', () => {
    const data = { current: 5, percentage: 50, total: 10 };
    expect(schema.parse(data)).toEqual(data);
  });

  test('allows missing percentage', () => {
    const data = { current: 3, total: 10 };
    expect(schema.parse(data)).toEqual(data);
  });

  test('rejects missing current', () => {
    expect(() => schema.parse({ total: 10 })).toThrow();
  });

  test('rejects non-number values', () => {
    expect(() => schema.parse({ current: 'five', total: 10 })).toThrow();
  });
});
