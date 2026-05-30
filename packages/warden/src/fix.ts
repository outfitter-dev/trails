/**
 * Safe-fix execution for `warden --fix` (TRL-833).
 *
 * Consumes the structured {@link WardenFix} metadata a rule attaches to its
 * diagnostics (TRL-831) and applies only the edits marked `safe`. Findings
 * whose fix is `review`-required, or that carry no edits, are never applied —
 * they stay reported so a human (or a downstream regrade) resolves them.
 *
 * The applicator is pure: it takes a file's source plus that file's
 * diagnostics and returns the patched source plus which diagnostics were
 * applied or skipped. The CLI layer owns reading and writing files.
 */

import type { WardenDiagnostic, WardenFixEdit } from './rules/types.js';

/** A safe edit resolved from a diagnostic, ready to apply to a source string. */
interface ResolvedEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/**
 * Apply a set of edits to a source string, last-to-first.
 *
 * Edits are applied in descending start order so earlier offsets stay valid as
 * later spans are spliced. Overlapping edits are a programming error in the
 * rule that produced them; this throws rather than silently corrupt source.
 */
const applyEdits = (source: string, edits: readonly ResolvedEdit[]): string => {
  for (const edit of edits) {
    if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end)) {
      throw new RangeError(
        `Fix edit [${String(edit.start)}, ${String(edit.end)}) must use safe integer offsets.`
      );
    }
  }

  const ordered = [...edits].toSorted(
    (left, right) => right.start - left.start
  );
  let result = source;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const edit of ordered) {
    if (edit.start < 0 || edit.end > source.length || edit.start > edit.end) {
      throw new RangeError(
        `Fix edit [${edit.start}, ${edit.end}) is out of bounds for source of length ${source.length}.`
      );
    }
    if (edit.end > lastStart) {
      throw new RangeError(
        `Fix edit [${edit.start}, ${edit.end}) overlaps a later edit starting at ${lastStart}.`
      );
    }
    result =
      result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    lastStart = edit.start;
  }
  return result;
};

/** Whether a diagnostic carries an applicable safe fix with concrete edits. */
export const hasSafeFixEdits = (
  diagnostic: WardenDiagnostic
): diagnostic is WardenDiagnostic & {
  readonly fix: { readonly edits: readonly WardenFixEdit[] };
} =>
  diagnostic.fix?.safety === 'safe' &&
  diagnostic.fix.edits !== undefined &&
  diagnostic.fix.edits.length > 0;

/** Result of applying safe fixes to a single file's source. */
export interface WardenFileFixResult {
  /** Source after applying every safe edit; unchanged when none applied. */
  readonly patched: string;
  /** Whether any edit was applied (i.e. `patched` differs from input). */
  readonly changed: boolean;
  /** Diagnostics whose safe fix was applied. */
  readonly applied: readonly WardenDiagnostic[];
  /** Diagnostics left reported (review-required, or no safe edits). */
  readonly skipped: readonly WardenDiagnostic[];
}

/**
 * Apply the safe fixes among a file's diagnostics to its source.
 *
 * Pure and filesystem-free. Only `safety: 'safe'` fixes with edits are applied;
 * everything else is returned in `skipped`. Edits from all applicable
 * diagnostics are pooled and applied last-to-first in one pass.
 */
export const applySafeFixesToSource = (
  source: string,
  diagnostics: readonly WardenDiagnostic[]
): WardenFileFixResult => {
  const applied: WardenDiagnostic[] = [];
  const skipped: WardenDiagnostic[] = [];
  const edits: ResolvedEdit[] = [];

  for (const diagnostic of diagnostics) {
    if (hasSafeFixEdits(diagnostic)) {
      applied.push(diagnostic);
      for (const edit of diagnostic.fix.edits) {
        edits.push({
          end: edit.end,
          replacement: edit.replacement,
          start: edit.start,
        });
      }
    } else {
      skipped.push(diagnostic);
    }
  }

  if (edits.length === 0) {
    return { applied, changed: false, patched: source, skipped };
  }

  const patched = applyEdits(source, edits);
  return { applied, changed: patched !== source, patched, skipped };
};
