/**
 * CLI-specific layers shipped with @ontrails/cli.
 */

import type { Layer, Implementation, Trail } from '@ontrails/core';
import { Result } from '@ontrails/core';

// ---------------------------------------------------------------------------
// Pagination output shape detection
// ---------------------------------------------------------------------------

interface ZodInternals {
  readonly _zod: {
    readonly def: Readonly<Record<string, unknown>>;
  };
}

/** Check if a trail's output schema looks like a paginated response. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isPaginatedOutput = (trail: Trail<any, any>): boolean => {
  if (!trail.output) {
    return false;
  }
  const s = trail.output as unknown as ZodInternals;
  const defType = s._zod.def['type'] as string;
  if (defType !== 'object') {
    return false;
  }

  const shape = s._zod.def['shape'] as Record<string, ZodInternals> | undefined;
  if (!shape) {
    return false;
  }

  return 'items' in shape && 'hasMore' in shape && 'nextCursor' in shape;
};

/** Check if a trail's input schema has since/until fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hasDateRangeFields = (trail: Trail<any, any>): boolean => {
  const s = trail.input as unknown as ZodInternals;
  const defType = s._zod.def['type'] as string;
  if (defType !== 'object') {
    return false;
  }

  const shape = s._zod.def['shape'] as Record<string, ZodInternals> | undefined;
  if (!shape) {
    return false;
  }

  return 'since' in shape || 'until' in shape;
};

// ---------------------------------------------------------------------------
// autoIterateGate
// ---------------------------------------------------------------------------

interface PaginatedInput {
  cursor?: string;
  all?: boolean;
  [key: string]: unknown;
}

interface PaginatedOutput {
  items: unknown[];
  hasMore: boolean;
  nextCursor?: string;
}

/** Fetch one page and extract items. Returns error result or page data. */
const fetchPage = async <I, O>(
  inp: PaginatedInput,
  cursor: string | undefined,
  implementation: Implementation<I, O>,
  ctx: Parameters<Implementation<I, O>>[1]
): Promise<Result<PaginatedOutput, Error>> => {
  const pageInput = { ...inp, cursor } as I;
  const result = await implementation(pageInput, ctx);
  if (result.isErr()) {
    return result as Result<PaginatedOutput, Error>;
  }
  return Result.ok(result.value as PaginatedOutput);
};

/** Accumulate items from a page and return the next cursor if there are more. */
const accumulatePage = (
  page: PaginatedOutput,
  allItems: unknown[]
): string | undefined => {
  allItems.push(...page.items);
  return page.hasMore && page.nextCursor ? page.nextCursor : undefined;
};

/** Collect all pages into a single result. */
const collectAllPages = async <I, O>(
  inp: PaginatedInput,
  implementation: Implementation<I, O>,
  ctx: Parameters<Implementation<I, O>>[1]
): Promise<Result<unknown, Error>> => {
  const allItems: unknown[] = [];
  let cursor: string | undefined;

  for (;;) {
    const pageResult = await fetchPage(inp, cursor, implementation, ctx);
    if (pageResult.isErr()) {
      return pageResult;
    }
    cursor = accumulatePage(pageResult.value as PaginatedOutput, allItems);
    if (cursor === undefined) {
      break;
    }
  }

  return Result.ok({ hasMore: false, items: allItems });
};

/**
 * Automatically iterates paginated results when --all flag is present.
 *
 * When a trail's output matches the pagination pattern (items, hasMore,
 * nextCursor) and the input contains `all: true`, this layer repeatedly
 * calls the implementation with incrementing cursors and collects all items.
 */
export const autoIterateGate: Layer = {
  description: 'Auto-paginate results when --all flag is set',
  name: 'autoIterate',

  wrap<I, O>(
    trail: Trail<I, O>,
    implementation: Implementation<I, O>
  ): Implementation<I, O> {
    if (!isPaginatedOutput(trail)) {
      return implementation;
    }

    return (input, ctx) => {
      const inp = input as PaginatedInput;
      if (!inp.all) {
        return implementation(input, ctx);
      }
      return collectAllPages(inp, implementation, ctx) as Promise<
        Result<O, Error>
      >;
    };
  },
};

// ---------------------------------------------------------------------------
// dateShortcutsGate
// ---------------------------------------------------------------------------

/** Build a date relative to today with a day offset. */
const daysAgo = (days: number): string => {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - days
  ).toISOString();
};

const dateShortcuts: Record<string, () => string> = {
  'this-month': () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  },
  'this-week': () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    return daysAgo(diff);
  },
  today: () => daysAgo(0),
  yesterday: () => daysAgo(1),
};

/** Expand a date shortcut to an ISO date string. */
const expandDateShortcut = (shortcut: string): string | undefined => {
  const handler = dateShortcuts[shortcut];
  if (handler) {
    return handler();
  }
  const match = /^(\d+)d$/.exec(shortcut);
  if (match?.[1]) {
    return daysAgo(Number(match[1]));
  }
  return undefined;
};

/** Expand since/until shortcuts in an input record. */
const expandDateFields = (
  inp: Record<string, unknown>
): Record<string, unknown> => {
  const modified = { ...inp };
  for (const field of ['since', 'until'] as const) {
    if (typeof inp[field] === 'string') {
      const expanded = expandDateShortcut(inp[field]);
      if (expanded) {
        modified[field] = expanded;
      }
    }
  }
  return modified;
};

/**
 * Expands date shortcut strings into ISO date ranges.
 *
 * When a trail's input has `since` or `until` fields, this layer
 * checks for shortcuts like "today", "yesterday", "7d", "30d",
 * "this-week", "this-month" and expands them to ISO 8601 dates.
 */
export const dateShortcutsGate: Layer = {
  description: 'Expand date shortcuts (today, 7d, etc.) to ISO dates',
  name: 'dateShortcuts',

  wrap<I, O>(
    trail: Trail<I, O>,
    implementation: Implementation<I, O>
  ): Implementation<I, O> {
    if (!hasDateRangeFields(trail)) {
      return implementation;
    }

    return (input, ctx) => {
      const modified = expandDateFields(input as Record<string, unknown>);
      return implementation(modified as I, ctx);
    };
  },
};
