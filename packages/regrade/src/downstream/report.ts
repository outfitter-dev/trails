import type { ValidationError } from '@ontrails/core';
import { NotFoundError, Result, trail, validateOutput } from '@ontrails/core';
import type {
  WardenDiagnostic,
  WardenFixEdit,
  WardenRule,
} from '@ontrails/warden';
import {
  getWardenRuleMetadata,
  isWardenSourceScanTarget,
  wardenRules,
} from '@ontrails/warden';
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

/**
 * Outcome a regrade class produces for a single source file. `skipped` means
 * the class declined to inspect the file (for example, a scan-target filter
 * excluded it) and it must not count as a scanned/clean no-op.
 */
export type RegradeOutcomeKind =
  | 'needs-review'
  | 'no-op'
  | 'rewrite'
  | 'skipped';

/** Result of applying one regrade class to one source string. */
export interface RegradeClassResult {
  readonly kind: RegradeOutcomeKind;
  /** Rewritten source, present only when `kind` is `rewrite`. */
  readonly nextSource?: string;
  /** Human-readable notes explaining the outcome. */
  readonly notes: readonly string[];
  /** Machine-readable reason for review outcomes. */
  readonly reason?: string;
}

/** Source-file context passed to Regrade classes. */
export interface RegradeClassContext {
  /** Root-relative POSIX path. */
  readonly path: string;
  /** Absolute path on disk, when the caller has one. */
  readonly absolutePath?: string;
}

/** One named, contract-aware transform. */
export interface RegradeClass {
  /** Stable identifier, e.g. `term-rewrite:signal->ping`. */
  readonly id: string;
  /** What the class does, for report and guide surfaces. */
  readonly describe: string;
  /** Apply the class to a source string. Must be pure and never throw. */
  readonly apply: (
    source: string,
    context?: RegradeClassContext
  ) => RegradeClassResult;
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
          reason: 'ambiguous-match',
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

const TERM_REWRITE_FIX_CLASS = 'term-rewrite';

type WardenEditApplication =
  | { readonly ok: true; readonly nextSource: string }
  | { readonly ok: false; readonly reason: string };

const diagnosticNote = (diagnostic: WardenDiagnostic): string => {
  const reason = diagnostic.fix?.reason ?? diagnostic.message;
  return `${diagnostic.rule}:${diagnostic.line}: ${reason}`;
};

const wardenFilePath = (context: RegradeClassContext | undefined): string =>
  context?.absolutePath ?? context?.path ?? '<regrade-source>';

const wardenScanPath = (context: RegradeClassContext | undefined): string =>
  context?.path ?? context?.absolutePath ?? '<regrade-source>';

const applyWardenEdits = (
  source: string,
  edits: readonly WardenFixEdit[]
): WardenEditApplication => {
  const ordered = [...edits].toSorted((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const edit of ordered) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length
    ) {
      return { ok: false, reason: 'invalid-edit-span' };
    }
    if (edit.start < previousEnd) {
      return { ok: false, reason: 'overlapping-edit-spans' };
    }
    previousEnd = edit.end;
  }

  let nextSource = source;
  for (const edit of ordered.toReversed()) {
    nextSource =
      nextSource.slice(0, edit.start) +
      edit.replacement +
      nextSource.slice(edit.end);
  }
  return { nextSource, ok: true };
};

export const createWardenTermRewriteClass = (
  rule: WardenRule
): RegradeClass | null => {
  const metadata = getWardenRuleMetadata(rule.name);
  if (metadata?.fix?.class !== TERM_REWRITE_FIX_CLASS) {
    return null;
  }

  return {
    apply: (
      source: string,
      context?: RegradeClassContext
    ): RegradeClassResult => {
      if (!isWardenSourceScanTarget(wardenScanPath(context))) {
        return {
          kind: 'skipped',
          notes: ['Skipped by Warden source scan-target filtering.'],
          reason: 'warden-scan-target-filtered',
        };
      }

      const diagnostics = rule
        .check(source, wardenFilePath(context))
        .filter(
          (diagnostic) => diagnostic.fix?.class === TERM_REWRITE_FIX_CLASS
        );

      if (diagnostics.length === 0) {
        return {
          kind: 'no-op',
          notes: [`No Warden ${TERM_REWRITE_FIX_CLASS} diagnostics found.`],
        };
      }

      const reviewDiagnostics = diagnostics.filter(
        (diagnostic) => diagnostic.fix?.safety !== 'safe'
      );
      if (reviewDiagnostics.length > 0) {
        return {
          kind: 'needs-review',
          notes: reviewDiagnostics.map(diagnosticNote),
          reason: 'warden-review-required',
        };
      }

      const diagnosticsMissingEdits = diagnostics.filter(
        (diagnostic) => (diagnostic.fix?.edits?.length ?? 0) === 0
      );
      if (diagnosticsMissingEdits.length > 0) {
        return {
          kind: 'needs-review',
          notes: diagnostics.map(diagnosticNote),
          reason: 'warden-fix-missing-edits',
        };
      }

      const edits = diagnostics.flatMap(
        (diagnostic) => diagnostic.fix?.edits ?? []
      );
      const application = applyWardenEdits(source, edits);
      if (!application.ok) {
        return {
          kind: 'needs-review',
          notes: [
            ...diagnostics.map(diagnosticNote),
            `Warden fix edits could not be applied: ${application.reason}.`,
          ],
          reason: 'warden-fix-invalid',
        };
      }

      return {
        kind: 'rewrite',
        nextSource: application.nextSource,
        notes: diagnostics.map(diagnosticNote),
      };
    },
    describe: `${rule.description} (${metadata.fix.safety} ${metadata.fix.class})`,
    id: `${metadata.fix.class}:${rule.name}`,
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
  context: RegradeClassContext,
  selected: readonly RegradeClass[]
): RegradeReportEntry => {
  // First selected class that matches (rewrite or review) wins, mirroring the
  // "run one class" emphasis. A scan-target skip is remembered so the file is
  // accounted as skipped rather than a scanned/clean no-op. No-ops fall through.
  let skipped:
    | { readonly classId: string; readonly result: RegradeClassResult }
    | undefined;
  for (const cls of selected) {
    const result = cls.apply(source, context);
    if (result.kind === 'rewrite') {
      return { classId: cls.id, notes: result.notes, outcome: 'rewrite', path };
    }
    if (result.kind === 'needs-review') {
      return {
        classId: cls.id,
        notes: result.notes,
        outcome: 'needs-review',
        path,
        reason: result.reason ?? 'needs-review',
      };
    }
    if (result.kind === 'skipped' && skipped === undefined) {
      skipped = { classId: cls.id, result };
    }
  }
  if (skipped !== undefined) {
    return {
      classId: skipped.classId,
      notes: skipped.result.notes,
      outcome: 'skip',
      path,
      reason: skipped.result.reason ?? 'skipped',
    };
  }
  return { outcome: 'no-op', path };
};

/**
 * Build a coverage report from already-read source files. Pure: no filesystem
 * access, so coverage semantics are testable directly.
 */
export const buildRegradeReport = (params: {
  readonly root: string;
  readonly files: readonly {
    readonly path: string;
    readonly source: string;
    readonly absolutePath?: string;
  }[];
  readonly skipped: readonly SkippedSource[];
  readonly classes: readonly RegradeClass[];
  readonly selection?: RegradeSelection;
}): RegradeReport => {
  const { selected, unknownClassIds } = selectRegradeClasses(
    params.classes,
    params.selection
  );

  const fileEntries = params.files.map((file) =>
    classifyFile(
      file.path,
      file.source,
      {
        ...(file.absolutePath === undefined
          ? {}
          : { absolutePath: file.absolutePath }),
        path: file.path,
      },
      selected
    )
  );
  const skipEntries: RegradeReportEntry[] = params.skipped.map((entry) => ({
    outcome: 'skip',
    path: entry.path,
    reason: entry.reason,
  }));

  const entries = [...fileEntries, ...skipEntries].toSorted((a, b) =>
    a.path.localeCompare(b.path)
  );

  // Class-level skips (e.g. scan-target filtering) are accounted as skipped, not
  // as scanned/clean files.
  const scannedEntries = fileEntries.filter((e) => e.outcome !== 'skip');
  const fileSkipCount = fileEntries.length - scannedEntries.length;
  const rewritten = scannedEntries.filter(
    (e) => e.outcome === 'rewrite'
  ).length;
  const review = scannedEntries.filter(
    (e) => e.outcome === 'needs-review'
  ).length;

  return {
    entries,
    matched: rewritten + review,
    review,
    rewritten,
    root: params.root,
    scanned: scannedEntries.length,
    selectedClassIds: selected.map((cls) => cls.id),
    skipped: skipEntries.length + fileSkipCount,
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

  const files: { absolutePath: string; path: string; source: string }[] = [];
  const skipped: SkippedSource[] = [...collected.skipped];
  for (const file of collected.files) {
    try {
      files.push({
        absolutePath: file.absolutePath,
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
 * Built-in regrade classes available to the report trail.
 *
 * Warden owns term detection and fix metadata. Regrade projects Warden rules
 * that advertise `term-rewrite` capability into reportable classes and then
 * owns application/reporting of the resulting rewrite or review outcomes.
 */
export const wardenTermRewriteClasses: readonly RegradeClass[] = Object.freeze(
  [...wardenRules.values()].flatMap((rule) => {
    const cls = createWardenTermRewriteClass(rule);
    return cls === null ? [] : [cls];
  })
);

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
      classes: wardenTermRewriteClasses,
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
