/**
 * CLI surface absorption for paginated trail outputs.
 *
 * When a trail's `output` schema matches the pagination shape
 * (`items`, `hasMore`, optional `nextCursor`), the CLI surface
 * derivation auto-emits an `--all` flag and, when set, iterates
 * the trail across pages — aggregating in memory by default, or
 * streaming per-item JSONL when `--jsonl` is also set.
 *
 * This module is the CLI-package-local home of the detection and
 * iteration helpers. The legacy `autoIterateLayer` in `./layers.ts`
 * remains exported for apps that still register it explicitly; the
 * derivation pipeline performs the same job without requiring an
 * authored layer.
 */

import type { Result } from '@ontrails/core';
import { Result as ResultNs, ValidationError } from '@ontrails/core';
import { z } from 'zod';

import type { AnyTrail } from './command.js';

// ---------------------------------------------------------------------------
// Paginated-shape detection
// ---------------------------------------------------------------------------

const objectShapeOf = (schema: unknown): Record<string, unknown> | null =>
  schema instanceof z.ZodObject
    ? (schema.shape as Record<string, unknown>)
    : null;

/**
 * Return true if a trail's output schema looks like a paginated response:
 * an object with `items`, `hasMore`, and `nextCursor` declared as fields.
 *
 * All three fields must be present in the schema's shape. The `nextCursor`
 * field's value can be optional or nullable, but the field itself must be
 * declared. Extra fields beyond the canonical three are tolerated.
 */
export const isPaginatedOutput = (trail: AnyTrail): boolean => {
  const fields = objectShapeOf(trail.output);
  if (fields === null) {
    return false;
  }
  return 'items' in fields && 'hasMore' in fields && 'nextCursor' in fields;
};

/**
 * Return true if a trail's input schema declares a `cursor` field.
 * When false, the iteration helper falls back to writing `nextCursor`
 * onto the merged input record.
 */
export const inputHasCursorField = (trail: AnyTrail): boolean => {
  const fields = objectShapeOf(trail.input);
  if (fields === null) {
    return false;
  }
  return 'cursor' in fields;
};

// ---------------------------------------------------------------------------
// Iteration
// ---------------------------------------------------------------------------

/**
 * Shape we expect to see on each successful iteration. The runtime check
 * below is permissive: we treat anything that does not match as a
 * non-iterable result and stop after the first page.
 */
interface PaginatedPage {
  readonly items: readonly unknown[];
  readonly hasMore: boolean;
  readonly nextCursor?: string | undefined;
}

const isPaginatedPage = (value: unknown): value is PaginatedPage => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PaginatedPage>;
  return (
    Array.isArray(candidate.items) && typeof candidate.hasMore === 'boolean'
  );
};

/**
 * Run a trail once for the given input and return the typed page result.
 * Used by the iteration loop below; never invoked when `--all` is unset.
 */
export type RunPageOnce = (
  input: Record<string, unknown>
) => Promise<Result<unknown, Error>>;

export interface IteratePagesOptions {
  /**
   * The user-merged input record before iteration begins. Each page
   * call is `{ ...baseInput, [cursorField]: <cursor> }`.
   */
  readonly baseInput: Record<string, unknown>;
  /** Field name to write the cursor onto. Defaults to `cursor`. */
  readonly cursorField: string;
  /** Per-page sink. When provided, items stream out as they arrive. */
  readonly onItem?: ((item: unknown) => void) | undefined;
  /** Run a single page. */
  readonly runPage: RunPageOnce;
}

/**
 * Resolve the next cursor for iteration. Returns `undefined` only when the
 * page declares `hasMore: false`. A truthy `hasMore` without a usable cursor
 * is a contract violation because `--all` cannot safely continue.
 */
const nextCursorOf = (
  page: PaginatedPage
): Result<string | undefined, ValidationError> => {
  if (!page.hasMore) {
    return ResultNs.ok();
  }
  if (typeof page.nextCursor === 'string' && page.nextCursor.length > 0) {
    return ResultNs.ok(page.nextCursor);
  }
  return ResultNs.err(
    new ValidationError(
      'Paginated trail returned hasMore=true without a non-empty nextCursor; --all iteration cannot continue without silently truncating results.'
    )
  );
};

const buildPageInput = (
  baseInput: Record<string, unknown>,
  cursorField: string,
  cursor: string | undefined
): Record<string, unknown> => {
  if (cursor === undefined) {
    return baseInput;
  }
  return { ...baseInput, [cursorField]: cursor };
};

const initialCursorOf = (
  baseInput: Record<string, unknown>,
  cursorField: string
): string | undefined => {
  const cursor = baseInput[cursorField];
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : undefined;
};

const repeatedCursorError = (cursor: string): ValidationError =>
  new ValidationError(
    `Paginated trail returned repeated nextCursor ${JSON.stringify(
      cursor
    )}; --all iteration requires each page to advance the cursor.`
  );

/**
 * Drain pages by repeatedly invoking `runPage` until the trail reports
 * `hasMore === false`. Returns a Result whose ok value matches the
 * canonical paginated shape with all collected items aggregated into
 * a single array.
 *
 * If a page is reached whose value does not match the paginated shape,
 * iteration stops and that page's value is returned verbatim — this is
 * a safety valve for trails that drift away from the contract at runtime.
 */
export const iteratePages = async (
  options: IteratePagesOptions
): Promise<Result<unknown, Error>> => {
  const { baseInput, cursorField, onItem, runPage } = options;
  const aggregated: unknown[] = [];
  const seenCursors = new Set<string>();
  const initialCursor = initialCursorOf(baseInput, cursorField);
  if (initialCursor !== undefined) {
    seenCursors.add(initialCursor);
  }
  let cursor: string | undefined;

  for (;;) {
    const pageInput = buildPageInput(baseInput, cursorField, cursor);
    const pageResult = await runPage(pageInput);
    if (pageResult.isErr()) {
      return pageResult;
    }
    const { value } = pageResult;
    if (!isPaginatedPage(value)) {
      if (onItem) {
        onItem(value);
        return ResultNs.ok({ hasMore: false, items: [] });
      }
      // Drift safety: hand the value back unchanged.
      return ResultNs.ok(value);
    }
    const nextResult = nextCursorOf(value);
    if (nextResult.isErr()) {
      return nextResult;
    }
    const next = nextResult.value;
    if (next !== undefined && seenCursors.has(next)) {
      return ResultNs.err(repeatedCursorError(next));
    }
    if (onItem) {
      for (const item of value.items) {
        onItem(item);
      }
    } else {
      for (const item of value.items) {
        aggregated.push(item);
      }
    }
    if (next === undefined) {
      break;
    }
    seenCursors.add(next);
    cursor = next;
  }

  return ResultNs.ok({ hasMore: false, items: onItem ? [] : aggregated });
};

// ---------------------------------------------------------------------------
// Streaming sink
// ---------------------------------------------------------------------------

/**
 * Write a single item as one JSON line to stdout. Mirrors the JSONL
 * shape that `output('jsonl')` would produce for an array element.
 */
export const writeJsonLine = (item: unknown): void => {
  process.stdout.write(`${JSON.stringify(item)}\n`);
};
