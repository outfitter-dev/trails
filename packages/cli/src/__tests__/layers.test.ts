import { describe, expect, test } from 'bun:test';

import { Result, createTrailContext, trail } from '@ontrails/core';
import type { Implementation, Trail } from '@ontrails/core';
import { z } from 'zod';

import { autoIterateLayer, dateShortcutsLayer } from '../layers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeCtx = () => createTrailContext();

interface DateInput {
  readonly since?: string | undefined;
  readonly until?: string | undefined;
}

const captureDateShortcutInput = async (
  dateTrail: Trail<DateInput, DateInput>,
  input: DateInput
): Promise<DateInput> => {
  let receivedInput: DateInput | undefined;
  const impl: Implementation<DateInput, DateInput> = (value) => {
    receivedInput = value;
    return Promise.resolve(Result.ok(value));
  };

  const wrapped = dateShortcutsLayer.wrap(dateTrail, impl);
  await wrapped(input, makeCtx());

  expect(receivedInput).toBeDefined();
  return receivedInput ?? {};
};

const expectSameDate = (value: string | undefined, expected: Date) => {
  expect(value).toBeDefined();
  const actual = new Date(value ?? '');
  expect(actual.getFullYear()).toBe(expected.getFullYear());
  expect(actual.getMonth()).toBe(expected.getMonth());
  expect(actual.getDate()).toBe(expected.getDate());
};

// ---------------------------------------------------------------------------
// autoIterateLayer
// ---------------------------------------------------------------------------

describe('autoIterateLayer', () => {
  const paginatedTrail = trail('list-items', {
    blaze: () => Result.ok({ hasMore: false, items: [] }),
    input: z.object({
      all: z.boolean().optional(),
      cursor: z.string().optional(),
    }),
    output: z.object({
      hasMore: z.boolean(),
      items: z.array(z.string()),
      nextCursor: z.string().optional(),
    }),
  });

  test('collects paginated results with --all flag', async () => {
    interface PageResult {
      items: string[];
      hasMore: boolean;
      nextCursor?: string | undefined;
    }
    const pages: PageResult[] = [
      { hasMore: true, items: ['a', 'b'], nextCursor: 'page2' },
      { hasMore: false, items: ['c'] },
    ];
    let callCount = 0;
    const impl: Implementation<
      { cursor?: string | undefined; all?: boolean | undefined },
      { items: string[]; hasMore: boolean; nextCursor?: string | undefined }
    > = () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index bounded by page count
      const page = pages[callCount]!;
      callCount += 1;
      return Promise.resolve(Result.ok(page));
    };

    const wrapped = autoIterateLayer.wrap(paginatedTrail, impl);
    const result = await wrapped({ all: true }, makeCtx());

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().items).toEqual(['a', 'b', 'c']);
    expect(result.unwrap().hasMore).toBe(false);
    expect(callCount).toBe(2);
  });

  test('passes through when --all is not set', async () => {
    let callCount = 0;
    const impl: Implementation<
      { cursor?: string | undefined; all?: boolean | undefined },
      { items: string[]; hasMore: boolean; nextCursor?: string | undefined }
    > = () => {
      callCount += 1;
      return Promise.resolve(
        Result.ok({ hasMore: true, items: ['a'], nextCursor: 'x' })
      );
    };

    const wrapped = autoIterateLayer.wrap(paginatedTrail, impl);
    const result = await wrapped({}, makeCtx());

    expect(callCount).toBe(1);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().items).toEqual(['a']);
  });

  test('ignores non-paginated trails', () => {
    const simpleTrail = trail('simple', {
      blaze: (input: { name: string }) => Result.ok(input.name),
      input: z.object({ name: z.string() }),
    });

    const impl: Implementation<{ name: string }, string> = async (input) =>
      await Promise.resolve(Result.ok(input.name));

    // Should return the same implementation (no wrapping)
    const wrapped = autoIterateLayer.wrap(simpleTrail, impl);
    // Reference equality may not hold with async wrapper, just verify it works
    expect(wrapped).toBe(impl);
  });
});

// ---------------------------------------------------------------------------
// dateShortcutsLayer
// ---------------------------------------------------------------------------

describe('dateShortcutsLayer', () => {
  const dateTrail = trail('events', {
    blaze: (input: {
      since?: string | undefined;
      until?: string | undefined;
    }) => Result.ok(input),
    input: z.object({
      since: z.string().optional(),
      until: z.string().optional(),
    }),
  });

  test("expands 'today' to correct date", async () => {
    const received = await captureDateShortcutInput(dateTrail, {
      since: 'today',
    });
    expectSameDate(received.since, new Date());
  });

  test("expands '7d' to 7-day range", async () => {
    const now = new Date();
    const expectedDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 7
    );
    const received = await captureDateShortcutInput(dateTrail, { since: '7d' });
    expectSameDate(received.since, expectedDate);
  });

  test('passes through non-shortcut values', async () => {
    let receivedInput: unknown;
    const impl: Implementation<
      { since?: string | undefined; until?: string | undefined },
      { since?: string | undefined; until?: string | undefined }
    > = (input) => {
      receivedInput = input;
      return Promise.resolve(Result.ok(input));
    };

    const isoDate = '2025-01-15T00:00:00.000Z';
    const wrapped = dateShortcutsLayer.wrap(dateTrail, impl);
    await wrapped({ since: isoDate }, makeCtx());

    const received = receivedInput as { since?: string };
    expect(received.since).toBe(isoDate);
  });

  test('ignores trails without date range fields', () => {
    const noDateTrail = trail('no-dates', {
      blaze: (input: { name: string }) => Result.ok(input.name),
      input: z.object({ name: z.string() }),
    });

    const impl: Implementation<{ name: string }, string> = async (input) =>
      await Promise.resolve(Result.ok(input.name));

    const wrapped = dateShortcutsLayer.wrap(noDateTrail, impl);
    expect(wrapped).toBe(impl);
  });

  test("expands 'yesterday'", async () => {
    let receivedInput: unknown;
    const impl: Implementation<
      { since?: string | undefined; until?: string | undefined },
      { since?: string | undefined; until?: string | undefined }
    > = (input) => {
      receivedInput = input;
      return Promise.resolve(Result.ok(input));
    };

    const wrapped = dateShortcutsLayer.wrap(dateTrail, impl);
    await wrapped({ since: 'yesterday' }, makeCtx());

    const received = receivedInput as { since?: string };
    expect(received.since).toBeDefined();
    const date = new Date(received.since as string);
    const now = new Date();
    const expected = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1
    );
    expect(date.getDate()).toBe(expected.getDate());
  });
});
