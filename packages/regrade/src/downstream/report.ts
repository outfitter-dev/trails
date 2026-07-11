import {
  InternalError,
  Result,
  escapeRegExp,
  includedByPathScope,
} from '@ontrails/core';
import type { ScanTargets } from '@ontrails/core';
import type {
  WardenDiagnostic,
  WardenFixEdit,
  WardenGuidance,
  WardenRule,
} from '@ontrails/warden';
import {
  getWardenRuleMetadata,
  isWardenSourceScanTarget,
  loadProjectWardenRules,
  wardenRules,
} from '@ontrails/warden';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';

import {
  DEFAULT_IGNORED_DIRECTORIES,
  DEFAULT_SOURCE_EXTENSIONS,
  collectDownstreamSources,
} from './collect.js';
import type { DownstreamCollectionOptions, SkippedSource } from './collect.js';
import {
  buildRegradeScanSummary,
  regradeScanSummaryOutput,
} from './scan-summary.js';
import type { RegradeScanSummary } from './scan-summary.js';
import type { VocabularyRegradeRun } from './vocabulary.js';
import { vocabularyRegradeRunOutput } from './vocabulary.js';

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
  /** Nearest owning package facts, when filesystem collection found a manifest. */
  readonly package?: {
    readonly dependencies: readonly string[];
    /** Runtime-visible dependency declarations (dependencies, optional, peer). */
    readonly runtimeDependencies?: readonly string[];
    readonly manifestState?: 'invalid' | 'valid';
    readonly name?: string;
    /** Root-relative POSIX manifest path. */
    readonly path: string;
  };
}

/** Files a regrade class knows how to inspect. */
export type RegradeScanTargets = ScanTargets & {
  /**
   * @deprecated Use collection-level `exclude` globs. Preserved so existing
   * Regrade classes can explicitly opt into directories the default collector
   * prunes, such as `dist`, while migrating to PathScope.
   */
  readonly ignoredDirectories?: readonly string[];
};

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

export interface RegradeWardenClassSet {
  /** Built-in and project-local Warden term-rewrite classes. */
  readonly classes: readonly RegradeClass[];
  /** Diagnostics raised while loading project-local rules. */
  readonly diagnostics: readonly WardenDiagnostic[];
}

/** Which regrade classes a run should execute. */
export interface RegradeSelection {
  /** Class ids to run. Omit to run every provided class. */
  readonly classIds?: readonly string[];
}

/** Which report entries should be returned. Counts always cover the full run. */
export type RegradeReportEntrySelection = 'actionable' | 'all';

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

/**
 * Verdict state for a review detail.
 *
 * - `unresolved`: the class could not complete occurrence judgment; a human or
 *   agent decision is still needed.
 * - `preserve`: a completed verdict to keep the occurrence as-is.
 * - `rewrite`: a completed verdict that a rewrite is intended but this run
 *   could not apply it (for example invalid or missing edits).
 */
export type RegradeReviewJudgment = 'preserve' | 'rewrite' | 'unresolved';

/** Structured detail explaining why a source match needs review. */
export interface RegradeReviewDetail {
  /** Concrete replacement the class would apply if the occurrence were judged safe. */
  readonly candidateReplacement?: string;
  /** Class that produced the review detail, injected by report building. */
  readonly classId?: string;
  /** Expected target shape when the class can describe one. */
  readonly expectedTarget?: string;
  /** Fixture or example reference that illustrates the expected migration. */
  readonly fixture?: string;
  /** Whether occurrence judgment is unresolved or a preserve/rewrite verdict completed. */
  readonly judgment?: RegradeReviewJudgment;
  /** Exact matched source text for the occurrence under review. */
  readonly matchedForm?: string;
  /** AST node kind or source construct kind. */
  readonly nodeKind?: string;
  /** Cautions explaining why a blind rewrite of this occurrence is unsafe. */
  readonly preserveCautions?: readonly string[];
  /** Machine-readable reason for review. */
  readonly reason: string;
  /** Machine-readable provenance tags for the producing rule or class. */
  readonly signals?: readonly string[];
  /** Source span and line/column for the review-required match. */
  readonly span?: RegradeReviewSpan;
  /** Suggested validation command after the review is resolved. */
  readonly suggestedValidation?: string;
  /** Symbol or term that triggered review. */
  readonly symbol?: string;
}

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

const regradeScanTargetsFromWardenFix = (
  scanTargets: NonNullable<
    NonNullable<ReturnType<typeof getWardenRuleMetadata>>['fix']
  >['scanTargets']
): RegradeScanTargets | undefined => {
  if (scanTargets === undefined) {
    return undefined;
  }
  return {
    ...(scanTargets.exclude === undefined
      ? {}
      : { exclude: scanTargets.exclude }),
    ...(scanTargets.extensions === undefined
      ? {}
      : { extensions: scanTargets.extensions }),
    ...(scanTargets.ignoredDirectories === undefined
      ? {}
      : { ignoredDirectories: scanTargets.ignoredDirectories }),
  };
};

const diagnosticNote = (diagnostic: WardenDiagnostic): string => {
  const reason = diagnostic.fix?.reason ?? diagnostic.message;
  return `${diagnostic.rule}:${diagnostic.line}: ${reason}`;
};

const firstQuotedValue = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const match = /['"]([^'"]+)['"]/.exec(value);
  return match?.[1];
};

const reviewSpanForOffsets = (
  source: string,
  start: number,
  end: number
): RegradeReviewSpan => {
  let line = 1;
  let column = 1;
  for (let index = 0; index < start; index += 1) {
    if (source.codePointAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { column, end, line, start };
};

const spanForSymbolOnDiagnosticLine = (
  source: string,
  line: number,
  symbol: string
): RegradeReviewSpan | undefined => {
  if (line < 1) {
    return undefined;
  }
  let lineStart = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const nextLineStart = source.indexOf('\n', lineStart);
    if (nextLineStart === -1) {
      return undefined;
    }
    lineStart = nextLineStart + 1;
  }
  const nextLineStart = source.indexOf('\n', lineStart);
  const lineEnd = nextLineStart === -1 ? source.length : nextLineStart;
  const symbolIndex = source.indexOf(symbol, lineStart);
  if (symbolIndex === -1 || symbolIndex >= lineEnd) {
    return undefined;
  }
  const nextSymbolIndex = source.indexOf(symbol, symbolIndex + symbol.length);
  if (nextSymbolIndex !== -1 && nextSymbolIndex < lineEnd) {
    return undefined;
  }
  return reviewSpanForOffsets(source, symbolIndex, symbolIndex + symbol.length);
};

const diagnosticSpan = (
  source: string,
  diagnostic: WardenDiagnostic,
  symbol: string | undefined
): RegradeReviewSpan | undefined => {
  const [edit] = diagnostic.fix?.edits ?? [];
  if (edit !== undefined) {
    return reviewSpanForOffsets(source, edit.start, edit.end);
  }
  if (symbol === undefined) {
    return undefined;
  }
  return spanForSymbolOnDiagnosticLine(source, diagnostic.line, symbol);
};

const diagnosticCandidateReplacement = (
  diagnostic: WardenDiagnostic
): string | undefined => {
  const replacements = new Set(
    (diagnostic.fix?.edits ?? []).map((edit) => edit.replacement)
  );
  if (replacements.size !== 1) {
    return undefined;
  }
  const [replacement] = replacements;
  return replacement;
};

const expectedTarget = (diagnostic: WardenDiagnostic): string | undefined => {
  const replacement = diagnosticCandidateReplacement(diagnostic);
  return replacement === undefined
    ? undefined
    : `Replace with "${replacement}".`;
};

const isValidEditSpan = (
  source: string,
  edit: WardenFixEdit | undefined
): edit is WardenFixEdit =>
  edit !== undefined &&
  Number.isInteger(edit.start) &&
  Number.isInteger(edit.end) &&
  edit.start >= 0 &&
  edit.end >= edit.start &&
  edit.end <= source.length;

const diagnosticMatchedForm = (
  source: string,
  diagnostic: WardenDiagnostic,
  symbol: string | undefined
): string | undefined => {
  const [edit] = diagnostic.fix?.edits ?? [];
  if (isValidEditSpan(source, edit)) {
    return source.slice(edit.start, edit.end);
  }
  return symbol;
};

const diagnosticSignals = (diagnostic: WardenDiagnostic): readonly string[] => [
  `warden:${diagnostic.rule}`,
  ...(diagnostic.code === undefined
    ? []
    : [`${diagnostic.rule}:${diagnostic.code}`]),
];

interface WardenReviewMappingOptions {
  /** Verdict state for this review path. */
  readonly judgment: RegradeReviewJudgment;
  /** Machine-readable review reason. */
  readonly reason: string;
  /** Rule-level guidance used when a finding carries none of its own. */
  readonly ruleGuidance?: WardenGuidance;
}

const reviewDetailFromDiagnostic = (
  source: string,
  diagnostic: WardenDiagnostic,
  options: WardenReviewMappingOptions
): RegradeReviewDetail => {
  const symbol =
    firstQuotedValue(diagnostic.fix?.reason) ??
    firstQuotedValue(diagnostic.message);
  const span = diagnosticSpan(source, diagnostic, symbol);
  const target = expectedTarget(diagnostic);
  const replacement = diagnosticCandidateReplacement(diagnostic);
  const matchedForm = diagnosticMatchedForm(source, diagnostic, symbol);
  const guidance = diagnostic.guidance ?? options.ruleGuidance;
  const preserveCautions =
    guidance === undefined
      ? undefined
      : [guidance.summary, ...(guidance.steps ?? [])];
  const suggestedValidation = guidance?.commands?.[0];
  return {
    ...(replacement === undefined ? {} : { candidateReplacement: replacement }),
    ...(target === undefined ? {} : { expectedTarget: target }),
    ...(diagnostic.fix?.fixture === undefined
      ? {}
      : { fixture: diagnostic.fix.fixture }),
    judgment: options.judgment,
    ...(matchedForm === undefined ? {} : { matchedForm }),
    ...(preserveCautions === undefined ? {} : { preserveCautions }),
    reason: options.reason,
    signals: diagnosticSignals(diagnostic),
    ...(span === undefined ? {} : { span }),
    ...(suggestedValidation === undefined ? {} : { suggestedValidation }),
    ...(symbol === undefined ? {} : { symbol }),
  } satisfies RegradeReviewDetail;
};

const reviewDetailsFromDiagnostics = (
  source: string,
  diagnostics: readonly WardenDiagnostic[],
  options: WardenReviewMappingOptions
): readonly RegradeReviewDetail[] | undefined => {
  const details = diagnostics.map((diagnostic) =>
    reviewDetailFromDiagnostic(source, diagnostic, options)
  );
  return details.length === 0 ? undefined : details;
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
  const metadata = getWardenRuleMetadata(rule);
  if (metadata?.fix?.class !== TERM_REWRITE_FIX_CLASS) {
    return null;
  }
  const scanTargets = regradeScanTargetsFromWardenFix(metadata.fix.scanTargets);

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
        // The rule flagged the occurrence but marked it review: occurrence
        // judgment is unresolved and needs a human or agent decision.
        const reviewDetails = reviewDetailsFromDiagnostics(
          source,
          reviewDiagnostics,
          {
            judgment: 'unresolved',
            reason: 'warden-review-required',
            ...(metadata.guidance === undefined
              ? {}
              : { ruleGuidance: metadata.guidance }),
          }
        );
        return {
          kind: 'needs-review',
          notes: reviewDiagnostics.map(diagnosticNote),
          reason: 'warden-review-required',
          ...(reviewDetails === undefined ? {} : { reviewDetails }),
        };
      }

      const diagnosticsMissingEdits = diagnostics.filter(
        (diagnostic) => (diagnostic.fix?.edits?.length ?? 0) === 0
      );
      if (diagnosticsMissingEdits.length > 0) {
        // A safe fix without concrete edits cannot complete occurrence
        // judgment on its own, so the verdict stays unresolved.
        const reviewDetails = reviewDetailsFromDiagnostics(
          source,
          diagnosticsMissingEdits,
          {
            judgment: 'unresolved',
            reason: 'warden-fix-missing-edits',
            ...(metadata.guidance === undefined
              ? {}
              : { ruleGuidance: metadata.guidance }),
          }
        );
        return {
          kind: 'needs-review',
          notes: diagnostics.map(diagnosticNote),
          reason: 'warden-fix-missing-edits',
          ...(reviewDetails === undefined ? {} : { reviewDetails }),
        };
      }

      const edits = diagnostics.flatMap(
        (diagnostic) => diagnostic.fix?.edits ?? []
      );
      const application = applyWardenEdits(source, edits);
      if (!application.ok) {
        // The rule completed judgment — it authored concrete edits — but this
        // run could not apply them, so the verdict is a rewrite left undone.
        const reviewDetails = reviewDetailsFromDiagnostics(
          source,
          diagnostics,
          {
            judgment: 'rewrite',
            reason: 'warden-fix-invalid',
            ...(metadata.guidance === undefined
              ? {}
              : { ruleGuidance: metadata.guidance }),
          }
        );
        return {
          kind: 'needs-review',
          notes: [
            ...diagnostics.map(diagnosticNote),
            `Warden fix edits could not be applied: ${application.reason}.`,
          ],
          reason: 'warden-fix-invalid',
          ...(reviewDetails === undefined ? {} : { reviewDetails }),
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
    ...(scanTargets === undefined ? {} : { scanTargets }),
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

const intersectValues = (
  left: readonly string[],
  right: readonly string[]
): readonly string[] => left.filter((value) => right.includes(value));

const deriveClassIgnoredDirectories = (
  classes: readonly RegradeClass[]
): readonly string[] | undefined => {
  const explicitTargets = classes
    .map((cls) => cls.scanTargets?.ignoredDirectories)
    .filter((value): value is readonly string[] => value !== undefined);
  if (explicitTargets.length === 0) {
    return undefined;
  }

  let common = explicitTargets[0] ?? [];
  for (const target of explicitTargets.slice(1)) {
    common = intersectValues(common, target);
  }
  return uniqueSorted(common);
};

const deriveCollectionOptions = (
  classes: readonly RegradeClass[],
  collection: DownstreamCollectionOptions | undefined
): DownstreamCollectionOptions => {
  const allExtensions = classes.some(
    (cls) => cls.scanTargets?.extensions?.length === 0
  );
  const targetExtensions = allExtensions
    ? []
    : uniqueSorted(
        classes.length === 0
          ? DEFAULT_SOURCE_EXTENSIONS
          : classes.flatMap(
              (cls) => cls.scanTargets?.extensions ?? DEFAULT_SOURCE_EXTENSIONS
            )
      );
  return {
    ...(collection?.exclude === undefined
      ? {}
      : { exclude: collection.exclude }),
    ...(collection?.include === undefined
      ? {}
      : { include: collection.include }),
    extensions: collection?.extensions ?? targetExtensions,
    ignoredDirectories:
      collection?.ignoredDirectories ??
      deriveClassIgnoredDirectories(classes) ??
      DEFAULT_IGNORED_DIRECTORIES,
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
  /** Skipped entries grouped by reason. */
  readonly skipsByReason: Readonly<Record<string, number>>;
  /** Agent-facing inventory summary for the scan. */
  readonly scan: RegradeScanSummary;
  /** Per-entry detail, sorted by path. */
  readonly entries: readonly RegradeReportEntry[];
  /** Apply-mode summary; absent for dry-run report-only calls. */
  readonly apply?: RegradeApplySummary;
  /** Vocabulary regrade run: plan, ledger, and completion report. */
  readonly run?: VocabularyRegradeRun;
  /** Saved active Regrade plan evidence for vocabulary regrades. */
  readonly plan?: {
    readonly expansionPending?: number;
    readonly path: string;
    readonly schemaVersion: number;
    readonly status: 'active' | 'stale';
  };
  /** Saved applied Regrade history evidence for vocabulary regrades. */
  readonly history?: {
    readonly path: string;
    readonly schemaVersion: number;
    readonly status: 'applied' | 'checked' | 'replay';
  };
  /**
   * @deprecated Persisted transition record evidence for vocabulary regrades.
   *   Use `plan` and `history` summaries in public surfaces.
   */
  readonly record?: {
    readonly path: string;
    readonly schemaVersion: number;
    readonly status: 'candidate' | 'applied' | 'checked';
  };
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

const isIgnoredByClassDirectories = (
  path: string,
  ignoredDirectories: readonly string[] | undefined
): boolean => {
  if (ignoredDirectories === undefined || ignoredDirectories.length === 0) {
    return false;
  }
  return path
    .split('/')
    .slice(0, -1)
    .some((segment) => ignoredDirectories.includes(segment));
};

const classScanTargetSkip = (
  cls: RegradeClass,
  path: string,
  collection: DownstreamCollectionOptions | undefined
): RegradeClassResult | undefined => {
  const ignoredDirectories =
    collection?.ignoredDirectories ??
    cls.scanTargets?.ignoredDirectories ??
    DEFAULT_IGNORED_DIRECTORIES;
  if (isIgnoredByClassDirectories(path, ignoredDirectories)) {
    return {
      kind: 'skipped',
      notes: [`Skipped by ${cls.id} scan-target filtering.`],
      reason: 'regrade-scan-target-filtered',
    };
  }
  const effectiveScanTargets: ScanTargets | undefined =
    cls.scanTargets?.extensions === undefined &&
    collection?.extensions === undefined
      ? {
          ...cls.scanTargets,
          extensions: DEFAULT_SOURCE_EXTENSIONS,
        }
      : cls.scanTargets;
  if (
    effectiveScanTargets === undefined ||
    includedByPathScope(path, effectiveScanTargets)
  ) {
    return undefined;
  }
  return {
    kind: 'skipped',
    notes: [`Skipped by ${cls.id} scan-target filtering.`],
    reason: 'regrade-scan-target-filtered',
  };
};

const classifyFile = (
  path: string,
  source: string,
  context: RegradeClassContext,
  selected: readonly RegradeClass[],
  collection?: DownstreamCollectionOptions
): RegradeClassifiedFile => {
  // Compose safe rewrites across selected classes in memory so one governed
  // transition can move every compatible symbol in a file. Review still wins:
  // if any class needs judgment, no partial rewrite is returned for that file.
  let skipped:
    | { readonly classId: string; readonly result: RegradeClassResult }
    | undefined;
  let inspected = false;
  let currentSource = source;
  const rewriteClassIds: string[] = [];
  const rewriteNotes: string[] = [];
  for (const cls of selected) {
    const result =
      classScanTargetSkip(cls, path, collection) ??
      cls.apply(currentSource, context);
    if (result.kind !== 'skipped') {
      inspected = true;
    }
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
      currentSource = result.nextSource;
      rewriteClassIds.push(cls.id);
      rewriteNotes.push(...(result.notes ?? []));
      continue;
    }
    if (result.kind === 'needs-review') {
      const originalSourceResult =
        currentSource === source ? result : cls.apply(source, context);
      const reviewResult =
        originalSourceResult.kind === 'needs-review'
          ? originalSourceResult
          : result;
      const reviewDetails = reviewResult.reviewDetails?.map((detail) => ({
        ...detail,
        classId: detail.classId ?? cls.id,
      }));
      return {
        entry: {
          classId: cls.id,
          notes: reviewResult.notes,
          outcome: 'needs-review',
          path,
          reason: reviewResult.reason ?? 'needs-review',
          ...(reviewDetails === undefined ? {} : { reviewDetails }),
        },
      };
    }
    if (result.kind === 'skipped' && skipped === undefined) {
      skipped = { classId: cls.id, result };
    }
  }
  if (rewriteClassIds.length > 0) {
    const classId = rewriteClassIds.join(',');
    const entry = {
      classId,
      notes: rewriteNotes,
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
              classId,
              nextSource: currentSource,
              path,
            },
          }),
    };
  }
  if (!inspected && skipped !== undefined) {
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

const includeEntryInReport = (
  entry: RegradeReportEntry,
  selection: RegradeReportEntrySelection
): boolean =>
  selection === 'all' ||
  entry.outcome === 'rewrite' ||
  entry.outcome === 'needs-review';

const skipsByReason = (
  entries: readonly RegradeReportEntry[]
): Readonly<Record<string, number>> => {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.outcome !== 'skip') {
      continue;
    }
    const reason = entry.reason ?? 'skipped';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].toSorted(([left], [right]) =>
      left.localeCompare(right)
    )
  );
};

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
    readonly package?: RegradeClassContext['package'];
  }[];
  readonly skipped: readonly SkippedSource[];
  readonly classes: readonly RegradeClass[];
  readonly selection?: RegradeSelection;
  readonly collection?: DownstreamCollectionOptions;
  readonly includeEntries?: RegradeReportEntrySelection;
}): RegradeEvaluation => {
  const entrySelection = params.includeEntries ?? 'actionable';
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
        ...(file.package === undefined ? {} : { package: file.package }),
        path: file.path,
      },
      selected,
      params.collection
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

  const allEntries = [...fileEntries, ...skipEntries].toSorted((a, b) =>
    a.path.localeCompare(b.path)
  );
  const entries = allEntries.filter((entry) =>
    includeEntryInReport(entry, entrySelection)
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
  const matchedPaths = scannedEntries
    .filter((e) => e.outcome === 'rewrite' || e.outcome === 'needs-review')
    .map((entry) => entry.path);
  const skipped = skipEntries.length + fileSkipCount;
  const skippedReasons = skipsByReason(allEntries);

  return {
    report: {
      entries,
      matched: rewritten + review,
      review,
      rewritten,
      root: params.root,
      scan: buildRegradeScanSummary({
        matchedPaths,
        scanned: scannedEntries.length,
        skipped,
        skippedByReason: skippedReasons,
      }),
      scanned: scannedEntries.length,
      selectedClassIds: selected.map((cls) => cls.id),
      skipped,
      skipsByReason: skippedReasons,
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
    readonly package?: RegradeClassContext['package'];
  }[];
  readonly skipped: readonly SkippedSource[];
  readonly classes: readonly RegradeClass[];
  readonly selection?: RegradeSelection;
  readonly collection?: DownstreamCollectionOptions;
  readonly includeEntries?: RegradeReportEntrySelection;
}): RegradeReport => buildRegradeEvaluation(params).report;

const applyRegradeEvaluation = (
  evaluation: RegradeEvaluation
): Result<RegradeApplySummary, InternalError> => {
  if (evaluation.report.unknownClassIds.length > 0) {
    return Result.ok({
      applied: 0,
      filesChanged: 0,
      review: evaluation.report.review,
      skipped: evaluation.report.skipped + evaluation.rewrites.length,
      unknown: evaluation.report.unknownClassIds.length,
    });
  }

  const changedFiles = new Set<string>();
  let applied = 0;
  for (const rewrite of evaluation.rewrites) {
    try {
      writeFileSync(rewrite.absolutePath, rewrite.nextSource, 'utf8');
    } catch (error: unknown) {
      return Result.err(
        new InternalError(
          `Failed to apply regrade rewrite for "${rewrite.path}".`,
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            context: {
              applied,
              classId: rewrite.classId,
              filesChanged: changedFiles.size,
              path: rewrite.path,
            },
          }
        )
      );
    }
    applied += 1;
    changedFiles.add(rewrite.path);
  }

  return Result.ok({
    applied: evaluation.rewrites.length,
    filesChanged: changedFiles.size,
    review: evaluation.report.review,
    skipped: evaluation.report.skipped,
    unknown: 0,
  });
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

const PACKAGE_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

const RUNTIME_PACKAGE_DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

const dependencyNames = (
  manifest: Readonly<Record<string, unknown>>,
  fields: readonly (typeof PACKAGE_DEPENDENCY_FIELDS)[number][]
): readonly string[] =>
  fields.flatMap((field) => {
    const value = manifest[field];
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.keys(value)
      : [];
  });

const packageContextFor = (
  root: string,
  absolutePath: string,
  cache: Map<string, RegradeClassContext['package'] | undefined>
): RegradeClassContext['package'] | undefined => {
  const absoluteRoot = resolve(root);
  let current = dirname(absolutePath);
  const visited: string[] = [];
  while (true) {
    if (cache.has(current)) {
      const cached = cache.get(current);
      for (const directory of visited) {
        cache.set(directory, cached);
      }
      return cached;
    }
    visited.push(current);
    const fromRoot = relative(absoluteRoot, current);
    if (fromRoot.startsWith('..') || resolve(current) !== current) {
      break;
    }
    const manifestPath = join(current, 'package.json');
    if (existsSync(manifestPath)) {
      const manifestRelativePath = relative(
        absoluteRoot,
        manifestPath
      ).replaceAll('\\', '/');
      try {
        const parsed = JSON.parse(
          readFileSync(manifestPath, 'utf8')
        ) as unknown;
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          const invalidContext = {
            dependencies: [],
            manifestState: 'invalid' as const,
            path: manifestRelativePath,
          };
          for (const directory of visited) {
            cache.set(directory, invalidContext);
          }
          return invalidContext;
        }
        const manifest = parsed as Record<string, unknown>;
        const dependencies = dependencyNames(
          manifest,
          PACKAGE_DEPENDENCY_FIELDS
        );
        const runtimeDependencies = dependencyNames(
          manifest,
          RUNTIME_PACKAGE_DEPENDENCY_FIELDS
        );
        const packageContext = {
          dependencies: [...new Set(dependencies)].toSorted(),
          manifestState: 'valid' as const,
          ...(typeof manifest['name'] === 'string'
            ? { name: manifest['name'] }
            : {}),
          path: manifestRelativePath,
          runtimeDependencies: [...new Set(runtimeDependencies)].toSorted(),
        };
        for (const directory of visited) {
          cache.set(directory, packageContext);
        }
        return packageContext;
      } catch {
        const invalidContext = {
          dependencies: [],
          manifestState: 'invalid' as const,
          path: manifestRelativePath,
        };
        for (const directory of visited) {
          cache.set(directory, invalidContext);
        }
        return invalidContext;
      }
    }
    if (current === absoluteRoot) {
      break;
    }
    current = dirname(current);
  }
  for (const directory of visited) {
    cache.set(directory, undefined);
  }
  return undefined;
};

const runRegradeEvaluation = (params: {
  readonly root: string;
  readonly classes: readonly RegradeClass[];
  readonly selection?: RegradeSelection;
  readonly collection?: DownstreamCollectionOptions;
  readonly includeEntries?: RegradeReportEntrySelection;
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
      ...(params.collection === undefined
        ? {}
        : { collection: params.collection }),
      files: [],
      root: params.root,
      skipped: [],
      ...(params.includeEntries === undefined
        ? {}
        : { includeEntries: params.includeEntries }),
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
  const packageContextCache = new Map<
    string,
    RegradeClassContext['package'] | undefined
  >();
  for (const file of collected.files) {
    try {
      const packageContext = packageContextFor(
        params.root,
        file.absolutePath,
        packageContextCache
      );
      files.push({
        absolutePath: file.absolutePath,
        ...(packageContext === undefined ? {} : { package: packageContext }),
        path: file.path,
        source: readFileSync(file.absolutePath, 'utf8'),
      });
    } catch {
      skipped.push({ path: file.path, reason: 'unreadable-file' });
    }
  }

  return buildRegradeEvaluation({
    classes: params.classes,
    ...(params.collection === undefined
      ? {}
      : { collection: params.collection }),
    files,
    root: params.root,
    skipped,
    ...(params.includeEntries === undefined
      ? {}
      : { includeEntries: params.includeEntries }),
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
  readonly includeEntries?: RegradeReportEntrySelection;
}): Result<RegradeReport | null, InternalError> => {
  const evaluation = runRegradeEvaluation(params);
  if (evaluation === null) {
    return Result.ok(null);
  }

  if (params.apply !== true) {
    return Result.ok(evaluation.report);
  }

  const applyResult = applyRegradeEvaluation(evaluation);
  if (applyResult.isErr()) {
    return applyResult;
  }

  return Result.ok(withApplySummary(evaluation.report, applyResult.value));
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
        candidateReplacement: z
          .string()
          .optional()
          .describe(
            'Concrete replacement the class would apply if the occurrence were judged safe'
          ),
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
        judgment: z
          .enum(['preserve', 'rewrite', 'unresolved'])
          .optional()
          .describe(
            'Verdict state: unresolved = occurrence judgment is incomplete and needs a human or agent decision; preserve = completed verdict to keep the occurrence; rewrite = completed verdict that a rewrite is intended but this run could not apply it'
          ),
        matchedForm: z
          .string()
          .optional()
          .describe(
            'Exact matched source text for the occurrence under review'
          ),
        nodeKind: z
          .string()
          .optional()
          .describe('AST node kind or source construct kind'),
        preserveCautions: z
          .array(z.string())
          .optional()
          .describe(
            'Cautions explaining why a blind rewrite of this occurrence is unsafe'
          ),
        reason: z.string().describe('Machine-readable review reason'),
        signals: z
          .array(z.string())
          .optional()
          .describe(
            'Machine-readable provenance tags for the producing rule or class'
          ),
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
    .describe(
      'Per-entry detail, sorted by path. Defaults to actionable rewrite/review entries.'
    ),
  history: z
    .object({
      path: z.string().describe('Root-relative applied history entry path'),
      schemaVersion: z.number().describe('Regrade history schema version'),
      status: z
        .enum(['applied', 'checked', 'replay'])
        .describe(
          'How this command used the Regrade history file: applied = run appended, replay = identical re-run recognized and not duplicated, checked = consolidated history verified per-run'
        ),
    })
    .optional()
    .describe('Saved applied Regrade history evidence'),
  matched: z.number().describe('Files with a rewrite or review outcome'),
  plan: z
    .object({
      expansionPending: z
        .number()
        .optional()
        .describe('Pending staged expansion candidates on this plan'),
      path: z.string().describe('Root-relative Regrade plan path'),
      schemaVersion: z.number().describe('Regrade plan schema version'),
      status: z
        .enum(['active', 'stale'])
        .describe('Whether the saved plan still matches the source tree'),
    })
    .optional()
    .describe('Saved active Regrade plan evidence'),
  record: z
    .object({
      path: z.string().describe('Root-relative transition record path'),
      schemaVersion: z.number().describe('Transition record schema version'),
      status: z
        .enum(['candidate', 'applied', 'checked'])
        .describe('How this command used the transition record'),
    })
    .optional()
    .describe('Persisted transition record evidence'),
  review: z.number().describe('Files routed to review'),
  rewritten: z.number().describe('Files with a rewrite outcome'),
  root: z.string().describe('Root the run scanned'),
  run: vocabularyRegradeRunOutput
    .optional()
    .describe('Vocabulary regrade run: plan, ledger, and completion report'),
  scan: regradeScanSummaryOutput.describe(
    'Agent-facing inventory summary for the scan'
  ),
  scanned: z.number().describe('Source files inspected'),
  selectedClassIds: z.array(z.string()).describe('Class ids executed'),
  skipped: z.number().describe('Entries skipped'),
  skipsByReason: z
    .record(z.string(), z.number())
    .describe('Skipped entries grouped by reason'),
  unknownClassIds: z
    .array(z.string())
    .describe('Selected ids that did not resolve to a class'),
});

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

const duplicateClassDiagnostics = (
  root: string,
  classes: readonly RegradeClass[]
): readonly WardenDiagnostic[] => {
  const seen = new Set<string>();
  const diagnostics: WardenDiagnostic[] = [];
  for (const cls of classes) {
    if (!seen.has(cls.id)) {
      seen.add(cls.id);
      continue;
    }
    diagnostics.push({
      filePath: root,
      line: 1,
      message: `Duplicate Regrade class id "${cls.id}" from Warden term-rewrite rules.`,
      rule: 'regrade-warden-term-rewrite-classes',
      severity: 'error',
    });
  }
  return diagnostics;
};

/**
 * Load built-in and project-local Warden term-rewrite rules as Regrade classes.
 *
 * Built-ins are always available. When `root` is provided, committed
 * project-local Warden rules under `.trails/rules.ts` or direct
 * `.trails/rules/*.ts` modules are loaded and any term-rewrite-capable source
 * rules join the class set.
 */
export const loadWardenTermRewriteClasses = async (
  root?: string
): Promise<RegradeWardenClassSet> => {
  if (root === undefined) {
    return { classes: wardenTermRewriteClasses, diagnostics: [] };
  }

  const projectRules = await loadProjectWardenRules(root);
  const projectClasses = projectRules.sourceRules.flatMap((rule) => {
    const cls = createWardenTermRewriteClass(rule);
    return cls === null ? [] : [cls];
  });
  const classes = [...wardenTermRewriteClasses, ...projectClasses];
  return {
    classes,
    diagnostics: [
      ...projectRules.diagnostics,
      ...duplicateClassDiagnostics(root, classes),
    ],
  };
};
