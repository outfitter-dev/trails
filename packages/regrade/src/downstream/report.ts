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
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import {
  collectDownstreamSources,
  DEFAULT_IGNORED_DIRECTORIES,
  DEFAULT_SOURCE_EXTENSIONS,
} from './collect.js';
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
  /** Structured details for review outcomes. */
  readonly reviewDetails?: readonly RegradeReviewDetail[];
}

/** Source-file context passed to Regrade classes. */
export interface RegradeClassContext {
  /** Root-relative POSIX path. */
  readonly path: string;
  /** Absolute path on disk, when the caller has one. */
  readonly absolutePath?: string;
}

/** Files a regrade class knows how to inspect. */
export interface RegradeScanTargets {
  /** Source extensions the class can inspect. */
  readonly extensions?: readonly string[];
  /** Directory names to skip during collection. */
  readonly ignoredDirectories?: readonly string[];
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
  /** Scan targets this class knows how to inspect. */
  readonly scanTargets?: RegradeScanTargets;
}

/** Which regrade classes a run should execute. */
export interface RegradeSelection {
  /** Class ids to run. Omit to run every provided class. */
  readonly classIds?: readonly string[];
}

/** Optional write summary for an apply-mode regrade run. */
export interface RegradeApplySummary {
  /** Safe rewrite outcomes written to disk. */
  readonly applied: number;
  /** Distinct files changed on disk. */
  readonly filesChanged: number;
  /** Rewrite candidates intentionally not written. */
  readonly skipped: number;
  /** Files still requiring review. */
  readonly review: number;
  /** Unknown selected class ids; apply mode writes nothing when non-zero. */
  readonly unknown: number;
}

/** Source location for a review-required match. */
export interface RegradeReviewSpan {
  readonly column: number;
  readonly end: number;
  readonly line: number;
  readonly start: number;
}

/** Structured detail explaining why a source match needs review. */
export interface RegradeReviewDetail {
  /** Class that produced the review detail, injected by report building. */
  readonly classId?: string;
  /** Expected target shape when the class can describe one. */
  readonly expectedTarget?: string;
  /** Fixture or example reference that illustrates the expected migration. */
  readonly fixture?: string;
  /** AST node kind or source construct kind. */
  readonly nodeKind?: string;
  /** Machine-readable reason for review. */
  readonly reason: string;
  /** Source span and line/column for the review-required match. */
  readonly span?: RegradeReviewSpan;
  /** Suggested validation command after the review is resolved. */
  readonly suggestedValidation?: string;
  /** Symbol or term that triggered review. */
  readonly symbol?: string;
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

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].toSorted((a, b) => a.localeCompare(b));

const deriveCollectionOptions = (
  classes: readonly RegradeClass[],
  collection: DownstreamCollectionOptions | undefined
): DownstreamCollectionOptions => {
  const targetExtensions = uniqueSorted(
    classes.length === 0
      ? DEFAULT_SOURCE_EXTENSIONS
      : classes.flatMap(
          (cls) => cls.scanTargets?.extensions ?? DEFAULT_SOURCE_EXTENSIONS
        )
  );
  const ignoredDirectories = uniqueSorted(
    classes.length === 0
      ? DEFAULT_IGNORED_DIRECTORIES
      : classes.flatMap(
          (cls) =>
            cls.scanTargets?.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES
        )
  );

  return {
    extensions: collection?.extensions ?? targetExtensions,
    ignoredDirectories: collection?.ignoredDirectories ?? ignoredDirectories,
  };
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
  /** Structured review details carried from the producing class. */
  readonly reviewDetails?: readonly RegradeReviewDetail[];
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
  /** Apply-mode summary; absent for dry-run report-only calls. */
  readonly apply?: RegradeApplySummary;
}

interface RegradeRewriteCandidate {
  readonly absolutePath: string;
  readonly classId: string;
  readonly nextSource: string;
  readonly path: string;
}

interface RegradeClassifiedFile {
  readonly entry: RegradeReportEntry;
  readonly rewrite?: RegradeRewriteCandidate;
}

const classifyFile = (
  path: string,
  source: string,
  context: RegradeClassContext,
  selected: readonly RegradeClass[]
): RegradeClassifiedFile => {
  // First selected class that matches (rewrite or review) wins, mirroring the
  // "run one class" emphasis. A scan-target skip is remembered so the file is
  // accounted as skipped rather than a scanned/clean no-op. No-ops fall through.
  let skipped:
    | { readonly classId: string; readonly result: RegradeClassResult }
    | undefined;
  for (const cls of selected) {
    const result = cls.apply(source, context);
    if (result.kind === 'rewrite') {
      if (typeof result.nextSource !== 'string') {
        return {
          entry: {
            classId: cls.id,
            notes: result.notes,
            outcome: 'needs-review',
            path,
            reason: 'regrade-rewrite-missing-source',
          },
        };
      }
      const entry = {
        classId: cls.id,
        notes: result.notes,
        outcome: 'rewrite',
        path,
      } satisfies RegradeReportEntry;
      return {
        entry,
        ...(context.absolutePath === undefined
          ? {}
          : {
              rewrite: {
                absolutePath: context.absolutePath,
                classId: cls.id,
                nextSource: result.nextSource,
                path,
              },
            }),
      };
    }
    if (result.kind === 'needs-review') {
      const reviewDetails = result.reviewDetails?.map((detail) => ({
        ...detail,
        classId: detail.classId ?? cls.id,
      }));
      return {
        entry: {
          classId: cls.id,
          notes: result.notes,
          outcome: 'needs-review',
          path,
          reason: result.reason ?? 'needs-review',
          ...(reviewDetails === undefined ? {} : { reviewDetails }),
        },
      };
    }
    if (result.kind === 'skipped' && skipped === undefined) {
      skipped = { classId: cls.id, result };
    }
  }
  if (skipped !== undefined) {
    return {
      entry: {
        classId: skipped.classId,
        notes: skipped.result.notes,
        outcome: 'skip',
        path,
        reason: skipped.result.reason ?? 'skipped',
      },
    };
  }
  return { entry: { outcome: 'no-op', path } };
};

interface RegradeEvaluation {
  readonly report: RegradeReport;
  readonly rewrites: readonly RegradeRewriteCandidate[];
}

/**
 * Build a coverage report from already-read source files. Pure: no filesystem
 * access, so coverage semantics are testable directly.
 */
const buildRegradeEvaluation = (params: {
  readonly root: string;
  readonly files: readonly {
    readonly path: string;
    readonly source: string;
    readonly absolutePath?: string;
  }[];
  readonly skipped: readonly SkippedSource[];
  readonly classes: readonly RegradeClass[];
  readonly selection?: RegradeSelection;
}): RegradeEvaluation => {
  const { selected, unknownClassIds } = selectRegradeClasses(
    params.classes,
    params.selection
  );

  const classifiedFiles = params.files.map((file) =>
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
  const fileEntries = classifiedFiles.map((file) => file.entry);
  const rewrites = classifiedFiles.flatMap((file) =>
    file.rewrite === undefined ? [] : [file.rewrite]
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
    report: {
      entries,
      matched: rewritten + review,
      review,
      rewritten,
      root: params.root,
      scanned: scannedEntries.length,
      selectedClassIds: selected.map((cls) => cls.id),
      skipped: skipEntries.length + fileSkipCount,
      unknownClassIds,
    },
    rewrites,
  };
};

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
}): RegradeReport => buildRegradeEvaluation(params).report;

const applyRegradeEvaluation = (
  evaluation: RegradeEvaluation
): RegradeApplySummary => {
  if (evaluation.report.unknownClassIds.length > 0) {
    return {
      applied: 0,
      filesChanged: 0,
      review: evaluation.report.review,
      skipped: evaluation.report.skipped + evaluation.rewrites.length,
      unknown: evaluation.report.unknownClassIds.length,
    };
  }

  const changedFiles = new Set<string>();
  for (const rewrite of evaluation.rewrites) {
    writeFileSync(rewrite.absolutePath, rewrite.nextSource, 'utf8');
    changedFiles.add(rewrite.path);
  }

  return {
    applied: evaluation.rewrites.length,
    filesChanged: changedFiles.size,
    review: evaluation.report.review,
    skipped: evaluation.report.skipped,
    unknown: 0,
  };
};

const withApplySummary = (
  report: RegradeReport,
  apply: RegradeApplySummary
): RegradeReport => ({
  ...report,
  apply,
});

const canReadDownstreamRoot = (root: string): boolean => {
  try {
    readdirSync(root, { withFileTypes: true });
    return true;
  } catch {
    return false;
  }
};

const runRegradeEvaluation = (params: {
  readonly root: string;
  readonly classes: readonly RegradeClass[];
  readonly selection?: RegradeSelection;
  readonly collection?: DownstreamCollectionOptions;
}): RegradeEvaluation | null => {
  const { selected, unknownClassIds } = selectRegradeClasses(
    params.classes,
    params.selection
  );
  if (selected.length === 0 && unknownClassIds.length > 0) {
    if (!canReadDownstreamRoot(params.root)) {
      return null;
    }
    return buildRegradeEvaluation({
      classes: params.classes,
      files: [],
      root: params.root,
      skipped: [],
      ...(params.selection === undefined
        ? {}
        : { selection: params.selection }),
    });
  }

  const collected = collectDownstreamSources(
    params.root,
    deriveCollectionOptions(selected, params.collection)
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

  return buildRegradeEvaluation({
    classes: params.classes,
    files,
    root: params.root,
    skipped,
    ...(params.selection === undefined ? {} : { selection: params.selection }),
  });
};

/**
 * Run a regrade over an explicit downstream root.
 *
 * Dry-run is the default and only reports candidate rewrites. Explicit apply
 * mode writes safe rewrite outcomes with concrete `nextSource` payloads and
 * summarizes what was written or intentionally skipped.
 */
export const runRegrade = (params: {
  readonly root: string;
  readonly classes: readonly RegradeClass[];
  readonly selection?: RegradeSelection;
  readonly collection?: DownstreamCollectionOptions;
  readonly apply?: boolean;
}): RegradeReport | null => {
  const evaluation = runRegradeEvaluation(params);
  if (evaluation === null) {
    return null;
  }

  if (params.apply !== true) {
    return evaluation.report;
  }

  return withApplySummary(
    evaluation.report,
    applyRegradeEvaluation(evaluation)
  );
};

const regradeReportEntrySchema = z.object({
  classId: z.string().optional().describe('Class that produced the outcome'),
  notes: z.array(z.string()).optional().describe('Notes from the class'),
  outcome: z
    .enum(['needs-review', 'no-op', 'rewrite', 'skip'])
    .describe('What happened to the entry'),
  path: z.string().describe('Root-relative POSIX path'),
  reason: z.string().optional().describe('Reason for a skip or review outcome'),
  reviewDetails: z
    .array(
      z.object({
        classId: z
          .string()
          .optional()
          .describe('Class that produced the review detail'),
        expectedTarget: z
          .string()
          .optional()
          .describe('Expected target shape for the migration'),
        fixture: z
          .string()
          .optional()
          .describe('Fixture or example reference for the migration'),
        nodeKind: z
          .string()
          .optional()
          .describe('AST node kind or source construct kind'),
        reason: z.string().describe('Machine-readable review reason'),
        span: z
          .object({
            column: z.number().describe('One-based source column'),
            end: z.number().describe('Source end offset'),
            line: z.number().describe('One-based source line'),
            start: z.number().describe('Source start offset'),
          })
          .optional()
          .describe('Source span that needs review'),
        suggestedValidation: z
          .string()
          .optional()
          .describe('Suggested validation command after resolving review'),
        symbol: z.string().optional().describe('Symbol or term under review'),
      })
    )
    .optional()
    .describe('Structured review details from the producing class'),
});

export const regradeReportInput = z.object({
  apply: z
    .boolean()
    .default(false)
    .describe('Write safe rewrites to disk; dry-run report only by default'),
  classIds: z
    .array(z.string())
    .optional()
    .describe('Regrade class ids to run (defaults to all built-in classes)'),
  root: z
    .string()
    .describe('Absolute path to the downstream repo root to scan'),
});

const regradeApplySummarySchema = z.object({
  applied: z.number().describe('Safe rewrite outcomes written to disk'),
  filesChanged: z.number().describe('Distinct files changed on disk'),
  review: z.number().describe('Files still requiring review'),
  skipped: z.number().describe('Rewrite candidates intentionally not written'),
  unknown: z.number().describe('Unknown selected class ids'),
});

export const regradeReportOutput = z.object({
  apply: regradeApplySummarySchema
    .optional()
    .describe('Apply-mode summary; absent for dry-run report-only calls'),
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
      apply: input.apply,
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
