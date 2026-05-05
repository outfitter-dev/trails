/**
 * CLI-surface bridge for the `run.example` trail.
 *
 * `run.example` resolves the named example on the target trail, executes it
 * through the full pipeline, and packages an actual-vs-expected comparison
 * into a structured envelope on the trail's outer `Result.ok(...)`. This module
 * owns the surface decision of how to render that envelope:
 *
 * - Text mode (default): a compact summary on match, an `input / expected /
 *   actual / diff` block on mismatch.
 * - JSON / JSONL: emits the full {@link RunExampleComparison} envelope so
 *   downstream consumers can parse the comparison shape directly.
 *
 * Match/mismatch is a comparison outcome, not an execution error: the trail
 * always returns `Result.ok(envelope)`. This helper maps mismatch onto a
 * non-zero exit code by throwing a `ValidationError` (category `validation`,
 * exit 1) so Commander's error path runs.
 *
 * Outer Err on the run trail (NotFound, Ambiguous, Validation) is unaffected
 * by `run.example`: this helper defers to the default handler so existing
 * exit-code mapping and recovery hooks stay intact.
 */

import type { ActionResultContext } from '@ontrails/cli';
import { deriveOutputMode, output } from '@ontrails/cli';
import { ValidationError } from '@ontrails/core';

import { runExampleComparisonSchema } from './trails/run-example.js';
import type { RunExampleComparison } from './trails/run-example.js';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const isExampleRunCtx = (ctx: ActionResultContext): boolean =>
  ctx.trail.id === 'run.example';

// ---------------------------------------------------------------------------
// Text formatting
// ---------------------------------------------------------------------------

const formatJson = (value: unknown): string => {
  try {
    const encoded = JSON.stringify(value, null, 2);
    return encoded === undefined ? String(value) : encoded;
  } catch {
    return String(value);
  }
};

const formatMatchText = (envelope: RunExampleComparison): string =>
  [
    `OK  ${envelope.trailId} :: ${envelope.exampleName}`,
    `mode: ${envelope.mode}`,
    'actual matches expected.',
  ].join('\n');

const formatMismatchText = (envelope: RunExampleComparison): string => {
  const diffBlock =
    envelope.diff !== undefined && envelope.diff.length > 0
      ? envelope.diff.map((line) => `  - ${line}`).join('\n')
      : '  - <no diff lines>';

  return [
    `MISMATCH  ${envelope.trailId} :: ${envelope.exampleName}`,
    `mode: ${envelope.mode}`,
    'input:',
    formatJson(envelope.input),
    'expected:',
    formatJson(envelope.expected),
    'actual:',
    formatJson(envelope.actual),
    'diff:',
    diffBlock,
  ].join('\n');
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Return value:
 * - `false` — `run.example` did not apply; caller should fall through to its
 *   default handler.
 * - `true` — `run.example` handled the result and wrote output. Caller should
 *   not invoke the default handler.
 *
 * Throws a {@link ValidationError} on mismatch so Commander's error path runs
 * and the run trail surface exits with the validation category exit code.
 */
export const tryExampleRunOutput = (ctx: ActionResultContext): boolean => {
  if (!isExampleRunCtx(ctx)) {
    return false;
  }

  // Outer Err on the run.example trail (NotFound, Ambiguous, Validation) is not
  // in scope here: defer to the default handler so existing
  // exit-code mapping and recovery hooks stay intact.
  if (ctx.result.isErr()) {
    return false;
  }

  const envelope = runExampleComparisonSchema.safeParse(ctx.result.value);
  if (!envelope.success) {
    // Defensive fallback: the trail owns the output schema, so this branch is
    // unreachable in practice. Defer to the default handler if anything else
    // slips through.
    return false;
  }
  const comparison = envelope.data;

  const { mode } = deriveOutputMode(ctx.flags, ctx.topoName);

  if (mode === 'text') {
    if (comparison.match) {
      output(formatMatchText(comparison), mode);
      return true;
    }
    process.stderr.write(`${formatMismatchText(comparison)}\n`);
    throw new ValidationError(
      `Example '${comparison.exampleName}' on trail '${comparison.trailId}' did not match expected outcome.`,
      {
        context: {
          exampleName: comparison.exampleName,
          mode: comparison.mode,
          trailId: comparison.trailId,
        },
      }
    );
  }

  // JSON / JSONL: emit the full envelope so downstream consumers can parse
  // the comparison shape directly.
  output(comparison, mode);
  if (!comparison.match) {
    throw new ValidationError(
      `Example '${comparison.exampleName}' on trail '${comparison.trailId}' did not match expected outcome.`,
      {
        context: {
          exampleName: comparison.exampleName,
          mode: comparison.mode,
          trailId: comparison.trailId,
        },
      }
    );
  }
  return true;
};
