import type { ValidationError } from '@ontrails/core';
import { NotFoundError, Result, trail, validateOutput } from '@ontrails/core';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

import { collectDownstreamSources } from './collect.js';
import type { DownstreamCollectionOptions, SkippedSource } from './collect.js';

/**
 * Regrade-class selection and coverage reporting (TRL-845).
 *
 * A regrade class is one named, contract-aware transform (for example a single
 * vocabulary rename). Selection lets a run apply one class without executing
 * every available transform, and {@link RegradeReport} captures coverage —
 * what was scanned, matched, rewritten, routed to review, and skipped — with
 * enough per-entry detail to debug why a file was omitted.
 *
 * The report logic is pure ({@link buildRegradeReport}); the filesystem walk
 * and file reads live in {@link runRegrade} and the wrapping trail. This keeps
 * coverage semantics testable without disk and consistent with the downstream
 * collection substrate (TRL-844).
 */

/** Outcome a regrade class produces for a single source file. */
export type RegradeOutcomeKind = 'needs-review' | 'no-op' | 'rewrite';

/** Result of applying one regrade class to one source string. */
export interface RegradeClassResult {
  readonly kind: RegradeOutcomeKind;
  /** Rewritten source, present only when `kind` is `rewrite`. */
  readonly nextSource?: string;
  /** Human-readable notes explaining the outcome. */
  readonly notes: readonly string[];
}

/** One named, contract-aware transform. */
export interface RegradeClass {
  /** Stable identifier, e.g. `term-rewrite:signal->ping`. */
  readonly id: string;
  /** What the class does, for report and guide surfaces. */
  readonly describe: string;
  /** Apply the class to a source string. Must be pure and never throw. */
  readonly apply: (source: string) => RegradeClassResult;
}

/** Which regrade classes a run should execute. */
export interface RegradeSelection {
  /** Class ids to run. Omit to run every provided class. */
  readonly classIds?: readonly string[];
}

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a whole-word term-rewrite class.
 *
 * Whole-word occurrences of `from` are rewritten to `to`. When `from` appears
 * only as part of a larger identifier (an ambiguous partial match), the class
 * routes the file to review instead of rewriting it — the canonical
 * "rename `signal` but do not touch `signalHandler`" case. This standalone
 * class anticipates TRL-832/836, where the mappings become Warden-owned.
 *
 * Matching is raw-text and lexer-unaware: a whole-word `from` inside a comment
 * or string literal counts exactly like a code reference (it is rewritten, and
 * a partial occurrence there still routes the file to review). For a vocabulary
 * migration this is usually desirable — comments and docs should track the
 * rename too — but it means callers cannot assume comment/string occurrences
 * are skipped. Lexer/AST-aware exclusion is deferred to the Warden-owned
 * term-rewrite metadata work (TRL-832/836).
 */
export const createTermRewriteClass = (options: {
  readonly from: string;
  readonly to: string;
  readonly id?: string;
  readonly describe?: string;
}): RegradeClass => {
  const { from, to } = options;
  const wholeWord = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g');
  return {
    apply: (source: string): RegradeClassResult => {
      const matches = source.match(wholeWord);
      const hasAmbiguousPartial = source.replace(wholeWord, '').includes(from);
      if (hasAmbiguousPartial) {
        return {
          kind: 'needs-review',
          notes: [
            `Found "${from}" inside larger identifiers; routed to review.`,
          ],
        };
      }
      if (matches && matches.length > 0) {
        return {
          kind: 'rewrite',
          nextSource: source.replace(wholeWord, to),
          notes: [`Rewrote ${matches.length} whole-word "${from}" -> "${to}".`],
        };
      }
      return { kind: 'no-op', notes: [`No "${from}" occurrences found.`] };
    },
    describe: options.describe ?? `Rewrite "${from}" to "${to}".`,
    id: options.id ?? `term-rewrite:${from}->${to}`,
  };
};

/**
 * Resolve the selected classes, preserving the order of `classIds` when given.
 * Unknown selected ids are returned so callers can report them.
 */
export const selectRegradeClasses = (
  classes: readonly RegradeClass[],
  selection: RegradeSelection = {}
): {
  readonly selected: readonly RegradeClass[];
  readonly unknownClassIds: readonly string[];
} => {
  if (selection.classIds === undefined) {
    return { selected: classes, unknownClassIds: [] };
  }
  const byId = new Map(classes.map((cls) => [cls.id, cls]));
  const selected: RegradeClass[] = [];
  const unknownClassIds: string[] = [];
  for (const id of selection.classIds) {
    const cls = byId.get(id);
    if (cls === undefined) {
      unknownClassIds.push(id);
    } else {
      selected.push(cls);
    }
  }
  return { selected, unknownClassIds };
};

/** Per-entry detail describing what happened to one path. */
export interface RegradeReportEntry {
  /** Root-relative POSIX path. */
  readonly path: string;
  /** What happened to the entry. */
  readonly outcome: 'needs-review' | 'no-op' | 'rewrite' | 'skip';
  /** Class that produced a rewrite or review outcome. */
  readonly classId?: string;
  /** Reason for a skip or review outcome. */
  readonly reason?: string;
  /** Notes carried from the producing class. */
  readonly notes?: readonly string[];
}

/** Coverage report for a regrade run. */
export interface RegradeReport {
  /** Root the run scanned. */
  readonly root: string;
  /** Class ids that were executed. */
  readonly selectedClassIds: readonly string[];
  /** Selected class ids that did not resolve to a known class. */
  readonly unknownClassIds: readonly string[];
  /** Source files inspected. */
  readonly scanned: number;
  /** Files where a selected class produced a rewrite or review outcome. */
  readonly matched: number;
  /** Files with a rewrite outcome. */
  readonly rewritten: number;
  /** Files routed to review. */
  readonly review: number;
  /** Entries skipped (collection skips plus any run-level skips). */
  readonly skipped: number;
  /** Per-entry detail, sorted by path. */
  readonly entries: readonly RegradeReportEntry[];
}

const classifyFile = (
  path: string,
  source: string,
  selected: readonly RegradeClass[]
): RegradeReportEntry => {
  // First selected class that matches (rewrite or review) wins, mirroring the
  // "run one class" emphasis. No-ops fall through to a no-op entry.
  for (const cls of selected) {
    const result = cls.apply(source);
    if (result.kind === 'rewrite') {
      return { classId: cls.id, notes: result.notes, outcome: 'rewrite', path };
    }
    if (result.kind === 'needs-review') {
      return {
        classId: cls.id,
        notes: result.notes,
        outcome: 'needs-review',
        path,
        reason: 'ambiguous-match',
      };
    }
  }
  return { outcome: 'no-op', path };
};

/**
 * Build a coverage report from already-read source files. Pure: no filesystem
 * access, so coverage semantics are testable directly.
 */
export const buildRegradeReport = (params: {
  readonly root: string;
  readonly files: readonly { readonly path: string; readonly source: string }[];
  readonly skipped: readonly SkippedSource[];
  readonly classes: readonly RegradeClass[];
  readonly selection?: RegradeSelection;
}): RegradeReport => {
  const { selected, unknownClassIds } = selectRegradeClasses(
    params.classes,
    params.selection
  );

  const fileEntries = params.files.map((file) =>
    classifyFile(file.path, file.source, selected)
  );
  const skipEntries: RegradeReportEntry[] = params.skipped.map((entry) => ({
    outcome: 'skip',
    path: entry.path,
    reason: entry.reason,
  }));

  const entries = [...fileEntries, ...skipEntries].toSorted((a, b) =>
    a.path.localeCompare(b.path)
  );

  const rewritten = fileEntries.filter((e) => e.outcome === 'rewrite').length;
  const review = fileEntries.filter((e) => e.outcome === 'needs-review').length;

  return {
    entries,
    matched: rewritten + review,
    review,
    rewritten,
    root: params.root,
    scanned: fileEntries.length,
    selectedClassIds: selected.map((cls) => cls.id),
    skipped: skipEntries.length,
    unknownClassIds,
  };
};

/**
 * Run a regrade over an explicit downstream root, producing a coverage report.
 *
 * Never throws: an unreadable root yields `null` (the trail maps it to a
 * `NotFoundError`); files that cannot be read are recorded as skips. This does
 * not write to disk — it reports the rewrites a run would make.
 */
export const runRegrade = (params: {
  readonly root: string;
  readonly classes: readonly RegradeClass[];
  readonly selection?: RegradeSelection;
  readonly collection?: DownstreamCollectionOptions;
}): RegradeReport | null => {
  const collected = collectDownstreamSources(
    params.root,
    params.collection ?? {}
  );
  if (collected === null) {
    return null;
  }

  const files: { path: string; source: string }[] = [];
  const skipped: SkippedSource[] = [...collected.skipped];
  for (const file of collected.files) {
    try {
      files.push({
        path: file.path,
        source: readFileSync(file.absolutePath, 'utf8'),
      });
    } catch {
      skipped.push({ path: file.path, reason: 'unreadable-file' });
    }
  }

  return buildRegradeReport({
    classes: params.classes,
    files,
    root: params.root,
    skipped,
    ...(params.selection === undefined ? {} : { selection: params.selection }),
  });
};

const regradeReportEntrySchema = z.object({
  classId: z.string().optional().describe('Class that produced the outcome'),
  notes: z.array(z.string()).optional().describe('Notes from the class'),
  outcome: z
    .enum(['needs-review', 'no-op', 'rewrite', 'skip'])
    .describe('What happened to the entry'),
  path: z.string().describe('Root-relative POSIX path'),
  reason: z.string().optional().describe('Reason for a skip or review outcome'),
});

export const regradeReportInput = z.object({
  classIds: z
    .array(z.string())
    .optional()
    .describe('Regrade class ids to run (defaults to all built-in classes)'),
  root: z
    .string()
    .describe('Absolute path to the downstream repo root to scan'),
});

export const regradeReportOutput = z.object({
  entries: z
    .array(regradeReportEntrySchema)
    .describe('Per-entry detail, sorted by path'),
  matched: z.number().describe('Files with a rewrite or review outcome'),
  review: z.number().describe('Files routed to review'),
  rewritten: z.number().describe('Files with a rewrite outcome'),
  root: z.string().describe('Root the run scanned'),
  scanned: z.number().describe('Source files inspected'),
  selectedClassIds: z.array(z.string()).describe('Class ids executed'),
  skipped: z.number().describe('Entries skipped'),
  unknownClassIds: z
    .array(z.string())
    .describe('Selected ids that did not resolve to a class'),
});

const validateRegradeReportOutput = (
  report: RegradeReport
): Result<z.infer<typeof regradeReportOutput>, ValidationError> =>
  validateOutput(regradeReportOutput, report);

/**
 * Preview regrade classes available to the report trail.
 *
 * This synthetic class keeps the report trail executable while the downstream
 * engine shape is still settling. It is not Warden-owned detection policy;
 * TRL-836 wires Warden-owned `term-rewrite` metadata into this set instead of
 * hand-authored preview mappings.
 */
export const previewRegradeClasses: readonly RegradeClass[] = Object.freeze([
  createTermRewriteClass({
    describe: 'Synthetic preview rewrite: signal -> ping',
    from: 'signal',
    id: 'preview.term-rewrite:signal->ping',
    to: 'ping',
  }),
]);

/**
 * Engine trail that produces a {@link RegradeReport} for an explicit root.
 *
 * No authored examples: the input is an absolute filesystem path. Correctness
 * is proven by the pure report unit tests and temp-directory run tests; the
 * committed Radio-shaped fixture (TRL-846) exercises it end to end.
 */
export const regradeReportTrail = trail('regrade.downstream.report', {
  blaze: (input) => {
    const report = runRegrade({
      classes: previewRegradeClasses,
      root: input.root,
      ...(input.classIds === undefined
        ? {}
        : { selection: { classIds: input.classIds } }),
    });
    if (report === null) {
      return Result.err(
        new NotFoundError(
          `Downstream root "${input.root}" could not be read as a directory.`
        )
      );
    }
    // Validate through the output schema so the returned value matches the trail's
    // mutable Zod-inferred output type. RegradeReport keeps idiomatic readonly
    // arrays for its domain consumers; the schema bridge validates without
    // throwing from the blaze.
    return validateRegradeReportOutput(report);
  },
  input: regradeReportInput,
  intent: 'read',
  output: regradeReportOutput,
});
