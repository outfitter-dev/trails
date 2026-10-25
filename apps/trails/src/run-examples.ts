/**
 * CLI-surface bridge for the `run.examples` trail.
 *
 * `run.examples` is a pure metadata read: the trail returns a
 * {@link RunExamplesListing} on its outer Ok value.
 * This module owns the surface decision of how to render that listing:
 *
 * - Text mode (default): a table-like list with `name`, truncated `input`,
 *   and outcome (`ok` / `error: <code>`). Empty listings print
 *   `No examples defined`.
 * - JSON / JSONL: the structured `examples` array is emitted directly via
 *   the resolved output mode, so agents and downstream consumers can parse
 *   the full structured shape (`name`, `input`, `expected`, `expectedMatch`,
 *   `error`, `signals`, `kind`, `provenance`).
 *
 * Errors at the outer layer (NotFoundError, AmbiguousError, ValidationError)
 * are unaffected by `run.examples`: we always defer to the supplied default
 * handler so the existing exit-code mapping and recovery hooks stay intact.
 */

import type { ActionResultContext } from '@ontrails/cli';
import { deriveOutputMode, output } from '@ontrails/cli';
import type { StructuredTrailExample } from '@ontrails/core';

import { runExamplesListingSchema } from './trails/run-examples.js';
import type { RunExamplesListing } from './trails/run-examples.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const isExamplesRunCtx = (ctx: ActionResultContext): boolean =>
  ctx.trail.id === 'run.examples';

// ---------------------------------------------------------------------------
// Text formatting
// ---------------------------------------------------------------------------

const INPUT_PREVIEW_LIMIT = 60;

const truncate = (value: string, limit: number): string => {
  if (limit <= 0) {
    return '';
  }
  if (Bun.stringWidth(value) <= limit) {
    return value;
  }

  let end = limit;
  let preview = Bun.sliceAnsi(value, 0, end, { ellipsis: '…' });
  // A wide grapheme at the boundary can round the slice past its cell budget.
  while (Bun.stringWidth(preview) > limit && end > 0) {
    end -= 1;
    preview = Bun.sliceAnsi(value, 0, end, { ellipsis: '…' });
  }
  return preview;
};

const formatInputPreview = (input: unknown): string => {
  if (input === undefined) {
    return '';
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(input) ?? '';
  } catch {
    encoded = String(input);
  }
  return truncate(encoded, INPUT_PREVIEW_LIMIT);
};

const formatOutcome = (example: StructuredTrailExample): string => {
  if (example.kind === 'error') {
    const code = example.error;
    return code === undefined || code.length === 0 ? 'error' : `error: ${code}`;
  }
  return 'ok';
};

interface ExampleRow {
  readonly name: string;
  readonly input: string;
  readonly outcome: string;
}

const buildRows = (
  examples: readonly StructuredTrailExample[]
): readonly ExampleRow[] =>
  examples.map((example) => ({
    input: formatInputPreview(example.input),
    name: example.name,
    outcome: formatOutcome(example),
  }));

const padRight = (value: string, width: number): string =>
  value + ' '.repeat(Math.max(0, width - Bun.stringWidth(value)));

const formatTable = (rows: readonly ExampleRow[]): string => {
  const headers = { input: 'INPUT', name: 'NAME', outcome: 'OUTCOME' };
  const allRows: readonly ExampleRow[] = [headers, ...rows];

  const widths = {
    input: Math.max(...allRows.map((row) => Bun.stringWidth(row.input))),
    name: Math.max(...allRows.map((row) => Bun.stringWidth(row.name))),
  };

  const formatRow = (row: ExampleRow): string =>
    `${padRight(row.name, widths.name)}  ${padRight(row.input, widths.input)}  ${row.outcome}`;

  return allRows.map(formatRow).join('\n');
};

const formatTextListing = (listing: RunExamplesListing): string => {
  if (listing.examples.length === 0) {
    return 'No examples defined';
  }
  return formatTable(buildRows(listing.examples));
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Return value:
 * - `false` — `run.examples` did not apply; caller should fall through to its
 *   default handler.
 * - `true` — `run.examples` handled the result and wrote output. Caller should
 *   not invoke the default handler.
 */
export const tryExamplesRunOutput = (ctx: ActionResultContext): boolean => {
  if (!isExamplesRunCtx(ctx)) {
    return false;
  }

  // Outer Err on `run.examples` (NotFound, Ambiguous, Validation) is not in
  // scope for this renderer: defer to the default handler so existing
  // exit-code mapping and recovery hooks stay intact.
  if (ctx.result.isErr()) {
    return false;
  }

  const listing = runExamplesListingSchema.safeParse(ctx.result.value);
  if (!listing.success) {
    // Defensive fallback: the trail owns the output schema, so this branch is
    // unreachable in practice. Defer to the default handler if anything else
    // slips through.
    return false;
  }

  const { mode } = deriveOutputMode(ctx.flags, ctx.topoName);

  if (mode === 'text') {
    output(formatTextListing(listing.data), mode);
    return true;
  }

  // Machine-readable modes retain the selection provenance alongside
  // the authored examples so callers never have to infer which app was read.
  output(listing.data, mode);
  return true;
};
