import {
  InternalError,
  Result,
  ValidationError,
  escapeRegExp,
  matchesAnyPathGlob,
} from '@ontrails/core';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import { collectDownstreamSources } from './collect.js';
import type { DownstreamCollectionOptions, SkippedSource } from './collect.js';
import type {
  RegradeApplySummary,
  RegradeReport,
  RegradeReportEntry,
} from './report.js';
import { buildRegradeScanSummary } from './scan-summary.js';

export type VocabularyVerdict = 'deferred' | 'modified' | 'skipped';

export const vocabularyDispositionValues = [
  'code-context-out-of-engine',
  'docs-only',
  'explicit-preserve',
  'forward-pointer',
  'ignored-by-scope',
  'in-family-modified',
  'in-family-unresolved',
  'out-of-family',
  'preserve-current-live-api',
] as const;

export type VocabularyDisposition =
  (typeof vocabularyDispositionValues)[number];

const vocabularyDispositions = new Set<string>(vocabularyDispositionValues);

export interface VocabularyPreserveRule {
  readonly disposition?: VocabularyDisposition;
  readonly pattern: string;
  readonly reason?: string;
  readonly paths?: readonly string[];
}

export interface VocabularyRegradeScope {
  readonly exclude?: readonly string[];
  readonly extensions?: readonly string[];
  /**
   * @deprecated Use `exclude` path globs for new plans. This remains as a
   * compatibility bridge for pre-path-scope plans that intentionally disabled
   * the collector's default directory pruning.
   */
  readonly ignoredDirectories?: readonly string[];
  readonly include?: readonly string[];
}

export interface VocabularyRegradePlan {
  readonly caseSensitive?: boolean;
  readonly deferForms?: readonly string[];
  readonly from: string;
  readonly id?: string;
  readonly intent?: string;
  readonly kind: 'vocabulary';
  readonly overrides?: Readonly<Record<string, string>>;
  readonly preserve?: readonly VocabularyPreserveRule[];
  readonly scope?: VocabularyRegradeScope;
  readonly to: string;
}

export interface VocabularyOccurrence {
  readonly column: number;
  readonly context: string;
  readonly disposition: VocabularyDisposition;
  readonly end: number;
  readonly form: string;
  readonly line: number;
  readonly path: string;
  readonly reason: string;
  readonly replacement?: string;
  readonly start: number;
  readonly verdict: VocabularyVerdict;
}

export interface VocabularyRunLedger {
  readonly cycle: number;
  readonly forms: Readonly<Record<string, VocabularyVerdict>>;
  readonly occurrences: readonly VocabularyOccurrence[];
}

export interface VocabularyRunGate {
  readonly remaining: number;
  readonly remainingByDisposition: Partial<
    Readonly<Record<VocabularyDisposition, number>>
  >;
  readonly reasons: readonly string[];
  readonly status: 'green' | 'open';
}

export interface VocabularyRunReport {
  readonly applied: number;
  readonly deferred: number;
  readonly dispositions: Partial<
    Readonly<Record<VocabularyDisposition, number>>
  >;
  readonly filesChanged: number;
  readonly gate: VocabularyRunGate;
  readonly modified: number;
  readonly open: number;
  readonly skipped: number;
}

export interface VocabularyRegradeRun {
  readonly ledger: VocabularyRunLedger;
  readonly plan: VocabularyRegradePlan;
  readonly report: VocabularyRunReport;
}

interface SourceFile {
  readonly absolutePath: string;
  readonly path: string;
  readonly source: string;
}

interface SourceOccurrence extends VocabularyOccurrence {
  readonly absolutePath: string;
}

type SourceOccurrenceDraft = Omit<
  SourceOccurrence,
  'disposition' | 'reason' | 'verdict'
>;

interface VocabularyEvaluation {
  readonly entries: readonly RegradeReportEntry[];
  readonly occurrences: readonly SourceOccurrence[];
  readonly scanned: number;
  readonly skipped: readonly SkippedSource[];
  readonly run: VocabularyRegradeRun;
}

const VOCABULARY_SOURCE_EXTENSIONS = Object.freeze([
  '.js',
  '.jsx',
  '.json',
  '.jsonc',
  '.md',
  '.mdx',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].toSorted((a, b) => a.localeCompare(b));

const vocabularyDispositionCounts = (
  occurrences: readonly VocabularyOccurrence[]
): Partial<Readonly<Record<VocabularyDisposition, number>>> => {
  const counts = new Map<VocabularyDisposition, number>();
  for (const occurrence of occurrences) {
    counts.set(
      occurrence.disposition,
      (counts.get(occurrence.disposition) ?? 0) + 1
    );
  }
  return Object.fromEntries(
    [...counts.entries()].toSorted(([left], [right]) =>
      left.localeCompare(right)
    )
  );
};

const isVocabularyTokenCharacter = (value: string): boolean =>
  /[A-Za-z0-9_$-]/.test(value);

const hasWordBoundary = (
  source: string,
  start: number,
  end: number
): boolean => {
  const before = start === 0 ? '' : (source.at(start - 1) ?? '');
  const after = end >= source.length ? '' : (source.at(end) ?? '');
  return (
    !isVocabularyTokenCharacter(before) && !isVocabularyTokenCharacter(after)
  );
};

const expandVocabularyNeighborSpan = (
  source: string,
  start: number,
  end: number
): { readonly end: number; readonly start: number } => {
  let expandedStart = start;
  while (
    expandedStart > 0 &&
    isVocabularyTokenCharacter(source.at(expandedStart - 1) ?? '')
  ) {
    expandedStart -= 1;
  }

  let expandedEnd = end;
  while (
    expandedEnd < source.length &&
    isVocabularyTokenCharacter(source.at(expandedEnd) ?? '')
  ) {
    expandedEnd += 1;
  }

  return { end: expandedEnd, start: expandedStart };
};

const lineColumnForOffset = (
  source: string,
  offset: number
): { readonly column: number; readonly line: number } => {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.codePointAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { column, line };
};

const contextForOffset = (
  source: string,
  start: number,
  end: number
): string => {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const nextLine = source.indexOf('\n', end);
  const lineEnd = nextLine === -1 ? source.length : nextLine;
  return source.slice(lineStart, lineEnd).trim();
};

const isMarkdownPath = (path: string): boolean =>
  path.endsWith('.md') || path.endsWith('.mdx');

const sourceLineBoundsForOffset = (
  source: string,
  start: number,
  end: number
): { readonly lineEnd: number; readonly lineStart: number } => {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const nextLine = source.indexOf('\n', end);
  return { lineEnd: nextLine === -1 ? source.length : nextLine, lineStart };
};

const markdownBacktickRuns = (value: string): readonly RegExpMatchArray[] => [
  ...value.matchAll(/(?<!\\)`+/g),
];

const isMarkdownInlineCodeContext = (
  source: string,
  start: number,
  end: number
): boolean => {
  const { lineEnd, lineStart } = sourceLineBoundsForOffset(source, start, end);
  const line = source.slice(lineStart, lineEnd);
  const relativeStart = start - lineStart;
  const relativeEnd = end - lineStart;
  let openRun: { readonly length: number; readonly start: number } | undefined;

  for (const run of markdownBacktickRuns(line)) {
    const runStart = run.index ?? 0;
    const [value] = run;
    const runLength = value.length;
    if (openRun === undefined) {
      openRun = { length: runLength, start: runStart };
      continue;
    }
    if (runLength !== openRun.length) {
      continue;
    }
    if (
      openRun.start + openRun.length <= relativeStart &&
      relativeEnd <= runStart
    ) {
      return true;
    }
    openRun = undefined;
  }

  return false;
};

const markdownFenceLinePattern = /^\s*(?:>\s*){0,8}(```|~~~)/;

const isMarkdownFenceContext = (source: string, start: number): boolean => {
  const before = source.slice(0, start);
  let fenced = false;
  for (const line of before.split('\n')) {
    if (markdownFenceLinePattern.test(line)) {
      fenced = !fenced;
    }
  }
  return fenced;
};

const isMarkdownCodeContext = (
  file: SourceFile,
  start: number,
  end: number
): boolean =>
  isMarkdownPath(file.path) &&
  (isMarkdownInlineCodeContext(file.source, start, end) ||
    isMarkdownFenceContext(file.source, start));

const vocabularyOccurrenceReason = (
  preserveRule: VocabularyPreserveRule | undefined,
  markdownCodeContext: boolean,
  defaultReason: string
): string => {
  if (preserveRule !== undefined) {
    return preserveRule.reason ?? 'preserved-by-plan';
  }
  if (markdownCodeContext) {
    return 'markdown-code-context';
  }
  return defaultReason;
};

const capturedVocabularyVerdict = (
  preserveRule: VocabularyPreserveRule | undefined,
  markdownCodeContext: boolean
): VocabularyVerdict => {
  if (preserveRule !== undefined) {
    return 'skipped';
  }
  if (markdownCodeContext) {
    return 'deferred';
  }
  return 'modified';
};

const vocabularyOccurrenceDisposition = (
  verdict: VocabularyVerdict,
  preserveRule: VocabularyPreserveRule | undefined,
  markdownCodeContext: boolean
): VocabularyDisposition => {
  if (preserveRule !== undefined) {
    return preserveRule.disposition ?? 'explicit-preserve';
  }
  if (markdownCodeContext) {
    return 'code-context-out-of-engine';
  }
  if (verdict === 'modified') {
    return 'in-family-modified';
  }
  return 'in-family-unresolved';
};

const preserveCase = (sourceForm: string, replacement: string): string => {
  if (sourceForm.toUpperCase() === sourceForm) {
    return replacement.toUpperCase();
  }
  const first = sourceForm.at(0);
  if (first !== undefined && first.toUpperCase() === first) {
    return replacement.at(0)?.toUpperCase() + replacement.slice(1);
  }
  return replacement;
};

const pluralize = (value: string): string =>
  value.endsWith('s') || value.endsWith('x') || value.endsWith('ch')
    ? `${value}es`
    : `${value}s`;

const defaultVocabularyForms = (from: string, to: string) =>
  new Map<string, string>([
    [from, to],
    [pluralize(from), pluralize(to)],
  ]);

const normalizedOverrideEntries = (
  overrides: Readonly<Record<string, string>> | undefined
): readonly [string, string][] =>
  Object.entries(overrides ?? {}).toSorted(([left], [right]) =>
    left.localeCompare(right)
  );

const targetFormsForPlan = (
  plan: VocabularyRegradePlan
): Map<string, string> => {
  const forms = defaultVocabularyForms(plan.from, plan.to);
  for (const [form, replacement] of normalizedOverrideEntries(plan.overrides)) {
    forms.set(form, replacement);
  }
  return forms;
};

const deferFormsForPlan = (plan: VocabularyRegradePlan): readonly string[] =>
  Array.isArray(plan.deferForms) ? uniqueSorted(plan.deferForms) : [];

const validateVocabularyPlan = (
  plan: VocabularyRegradePlan
): Result<void, ValidationError> => {
  if (plan.from.trim().length === 0) {
    return Result.err(
      new ValidationError('Vocabulary Regrade plan `from` cannot be empty.')
    );
  }
  if (plan.to.trim().length === 0) {
    return Result.err(
      new ValidationError('Vocabulary Regrade plan `to` cannot be empty.')
    );
  }
  for (const [form, replacement] of normalizedOverrideEntries(plan.overrides)) {
    if (form.trim().length === 0) {
      return Result.err(
        new ValidationError(
          'Vocabulary Regrade plan override keys cannot be empty.'
        )
      );
    }
    if (replacement.trim().length === 0) {
      return Result.err(
        new ValidationError(
          `Vocabulary Regrade plan override "${form}" cannot map to an empty replacement.`
        )
      );
    }
  }
  for (const form of deferFormsForPlan(plan)) {
    if (form.trim().length === 0) {
      return Result.err(
        new ValidationError(
          'Vocabulary Regrade plan deferForms entries cannot be empty.'
        )
      );
    }
  }
  for (const rule of plan.preserve ?? []) {
    if (rule.pattern.trim().length === 0) {
      return Result.err(
        new ValidationError(
          'Vocabulary Regrade plan preserve patterns cannot be empty.'
        )
      );
    }
    if (
      rule.disposition !== undefined &&
      !vocabularyDispositions.has(rule.disposition)
    ) {
      return Result.err(
        new ValidationError(
          `Vocabulary Regrade plan preserve disposition "${rule.disposition}" is not supported.`
        )
      );
    }
  }
  return Result.ok();
};

const vocabularyScanFlags = (plan: VocabularyRegradePlan): string =>
  plan.caseSensitive === true ? 'g' : 'gi';

const includedByScope = (
  path: string,
  scope: VocabularyRegradeScope | undefined
): boolean =>
  (scope?.include === undefined ||
    scope.include.length === 0 ||
    matchesAnyPathGlob(path, scope.include)) &&
  !matchesAnyPathGlob(path, scope?.exclude);

const compilePreservePattern = (pattern: string): RegExp => {
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(escapeRegExp(pattern));
  }
};

const preserveRuleForOccurrence = (
  occurrence: SourceOccurrenceDraft,
  plan: VocabularyRegradePlan
): VocabularyPreserveRule | undefined =>
  plan.preserve?.find((rule) => {
    if (
      rule.paths !== undefined &&
      !matchesAnyPathGlob(occurrence.path, rule.paths)
    ) {
      return false;
    }
    return (
      compilePreservePattern(rule.pattern).test(occurrence.context) ||
      compilePreservePattern(rule.pattern).test(occurrence.form)
    );
  });

const occurrenceOverlaps = (
  occurrences: readonly SourceOccurrence[],
  start: number,
  end: number
): boolean =>
  occurrences.some(
    (occurrence) => start < occurrence.end && occurrence.start < end
  );

const occurrenceDraftForSpan = (
  file: SourceFile,
  start: number,
  end: number,
  form = file.source.slice(start, end)
): SourceOccurrenceDraft => {
  const { column, line } = lineColumnForOffset(file.source, start);
  return {
    absolutePath: file.absolutePath,
    column,
    context: contextForOffset(file.source, start, end),
    end,
    form,
    line,
    path: file.path,
    start,
  };
};

const deferredOccurrenceFromDraft = (
  file: SourceFile,
  plan: VocabularyRegradePlan,
  baseOccurrence: SourceOccurrenceDraft,
  reason = 'unclassified-neighbor'
): SourceOccurrence => {
  const preserveRule = preserveRuleForOccurrence(baseOccurrence, plan);
  const markdownCodeContext = isMarkdownCodeContext(
    file,
    baseOccurrence.start,
    baseOccurrence.end
  );
  const verdict = preserveRule === undefined ? 'deferred' : 'skipped';
  return {
    ...baseOccurrence,
    disposition: vocabularyOccurrenceDisposition(
      verdict,
      preserveRule,
      markdownCodeContext
    ),
    reason: vocabularyOccurrenceReason(
      preserveRule,
      markdownCodeContext,
      reason
    ),
    verdict,
  };
};

const exactDeferredFormOccurrencesForFile = (
  file: SourceFile,
  plan: VocabularyRegradePlan,
  deferForms: readonly string[]
): readonly SourceOccurrence[] => {
  const occurrences: SourceOccurrence[] = [];
  for (const form of deferForms) {
    const pattern = new RegExp(escapeRegExp(form), vocabularyScanFlags(plan));
    for (const match of file.source.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (
        !hasWordBoundary(file.source, start, end) ||
        occurrenceOverlaps(occurrences, start, end)
      ) {
        continue;
      }
      occurrences.push(
        deferredOccurrenceFromDraft(
          file,
          plan,
          occurrenceDraftForSpan(file, start, end, match[0]),
          'deferred-form'
        )
      );
    }
  }
  return occurrences;
};

const occurrencesForFile = (
  file: SourceFile,
  plan: VocabularyRegradePlan,
  targetForms: Map<string, string>,
  deferredOccurrences: readonly SourceOccurrence[]
): readonly SourceOccurrence[] => {
  const occurrences: SourceOccurrence[] = [];
  const candidates: SourceOccurrence[] = [];
  const forms = [...targetForms.entries()].toSorted(
    ([left], [right]) => right.length - left.length || left.localeCompare(right)
  );

  for (const [form, replacement] of forms) {
    const pattern = new RegExp(escapeRegExp(form), vocabularyScanFlags(plan));
    for (const match of file.source.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (
        !hasWordBoundary(file.source, start, end) ||
        occurrenceOverlaps(deferredOccurrences, start, end)
      ) {
        continue;
      }
      const { column, line } = lineColumnForOffset(file.source, start);
      const baseOccurrence = {
        absolutePath: file.absolutePath,
        column,
        context: contextForOffset(file.source, start, end),
        end,
        form: match[0],
        line,
        path: file.path,
        start,
      };
      const preserveRule = preserveRuleForOccurrence(baseOccurrence, plan);
      const markdownCodeContext = isMarkdownCodeContext(file, start, end);
      const verdict = capturedVocabularyVerdict(
        preserveRule,
        markdownCodeContext
      );
      candidates.push({
        ...baseOccurrence,
        disposition: vocabularyOccurrenceDisposition(
          verdict,
          preserveRule,
          markdownCodeContext
        ),
        reason: vocabularyOccurrenceReason(
          preserveRule,
          markdownCodeContext,
          'captured-form'
        ),
        ...(preserveRule === undefined && !markdownCodeContext
          ? { replacement: preserveCase(match[0], replacement) }
          : {}),
        verdict,
      });
    }
  }

  for (const candidate of candidates.toSorted(
    (left, right) =>
      right.end - right.start - (left.end - left.start) ||
      left.start - right.start
  )) {
    const overlaps = occurrences.some(
      (occurrence) =>
        candidate.start < occurrence.end && occurrence.start < candidate.end
    );
    if (!overlaps) {
      occurrences.push(candidate);
    }
  }

  return occurrences.toSorted((left, right) =>
    left.path === right.path
      ? left.start - right.start
      : left.path.localeCompare(right.path)
  );
};

const deferredOccurrencesForFile = (
  file: SourceFile,
  plan: VocabularyRegradePlan,
  targetForms: Map<string, string>
): readonly SourceOccurrence[] => {
  const deferForms = deferFormsForPlan(plan);
  const knownForms = new Set(
    plan.caseSensitive === true
      ? [...targetForms.keys(), ...deferForms]
      : [...targetForms.keys(), ...deferForms].flatMap((form) => [
          form,
          form.toLowerCase(),
        ])
  );
  const lowerFrom = plan.from.toLowerCase();
  const tokenPattern = /[A-Za-z_$][A-Za-z0-9_$-]*/g;
  const occurrences = [
    ...exactDeferredFormOccurrencesForFile(file, plan, deferForms),
  ];

  for (const form of targetForms.keys()) {
    const pattern = new RegExp(escapeRegExp(form), vocabularyScanFlags(plan));
    for (const match of file.source.matchAll(pattern)) {
      const matchStart = match.index ?? 0;
      const matchEnd = matchStart + match[0].length;
      if (hasWordBoundary(file.source, matchStart, matchEnd)) {
        continue;
      }
      const { end, start } = expandVocabularyNeighborSpan(
        file.source,
        matchStart,
        matchEnd
      );
      const matchedForm = file.source.slice(start, end);
      const lowerMatchedForm = matchedForm.toLowerCase();
      if (
        occurrenceOverlaps(occurrences, start, end) ||
        knownForms.has(matchedForm) ||
        (plan.caseSensitive !== true && knownForms.has(lowerMatchedForm)) ||
        !lowerMatchedForm.includes(lowerFrom)
      ) {
        continue;
      }
      occurrences.push(
        deferredOccurrenceFromDraft(
          file,
          plan,
          occurrenceDraftForSpan(file, start, end, matchedForm)
        )
      );
    }
  }

  for (const match of file.source.matchAll(tokenPattern)) {
    const [form] = match;
    const lower = form.toLowerCase();
    if (
      knownForms.has(form) ||
      (plan.caseSensitive !== true && knownForms.has(lower))
    ) {
      continue;
    }
    if (!lower.includes(lowerFrom)) {
      continue;
    }
    const start = match.index ?? 0;
    const end = start + form.length;
    if (occurrenceOverlaps(occurrences, start, end)) {
      continue;
    }
    occurrences.push(
      deferredOccurrenceFromDraft(
        file,
        plan,
        occurrenceDraftForSpan(file, start, end, form)
      )
    );
  }
  return occurrences.toSorted((left, right) =>
    left.path === right.path
      ? left.start - right.start
      : left.path.localeCompare(right.path)
  );
};

const entryForOccurrences = (
  path: string,
  occurrences: readonly SourceOccurrence[]
): RegradeReportEntry | null => {
  if (occurrences.length === 0) {
    return null;
  }
  const hasDeferred = occurrences.some(
    (occurrence) => occurrence.verdict === 'deferred'
  );
  const hasModified = occurrences.some(
    (occurrence) => occurrence.verdict === 'modified'
  );
  if (hasDeferred) {
    return {
      notes: [
        `Found ${occurrences.length} vocabulary occurrence(s); judgment deferred.`,
      ],
      outcome: 'needs-review',
      path,
      reason: 'vocabulary-judgment-deferred',
      reviewDetails: occurrences
        .filter((occurrence) => occurrence.verdict === 'deferred')
        .map((occurrence) => ({
          expectedTarget:
            'Add an override or preserve rule to the regrade plan.',
          reason: occurrence.reason,
          span: {
            column: occurrence.column,
            end: occurrence.end,
            line: occurrence.line,
            start: occurrence.start,
          },
          symbol: occurrence.form,
        })),
    };
  }
  if (hasModified) {
    return {
      notes: [
        `Found ${occurrences.length} vocabulary occurrence(s); safe modifications available.`,
      ],
      outcome: 'rewrite',
      path,
    };
  }
  return {
    notes: [`Skipped ${occurrences.length} vocabulary occurrence(s).`],
    outcome: 'no-op',
    path,
  };
};

const applyOccurrenceRewrites = (
  file: SourceFile,
  occurrences: readonly SourceOccurrence[]
): string => {
  let nextSource = file.source;
  for (const occurrence of occurrences.toReversed()) {
    if (
      occurrence.verdict !== 'modified' ||
      occurrence.replacement === undefined
    ) {
      continue;
    }
    nextSource =
      nextSource.slice(0, occurrence.start) +
      occurrence.replacement +
      nextSource.slice(occurrence.end);
  }
  return nextSource;
};

const buildVocabularyEvaluation = (params: {
  readonly apply?: boolean;
  readonly files: readonly SourceFile[];
  readonly plan: VocabularyRegradePlan;
  readonly root: string;
  readonly skipped: readonly SkippedSource[];
}): VocabularyEvaluation => {
  const targetForms = targetFormsForPlan(params.plan);
  const scopedFiles = params.files.filter((file) =>
    includedByScope(file.path, params.plan.scope)
  );
  const scopeSkipped: SkippedSource[] = params.files
    .filter((file) => !includedByScope(file.path, params.plan.scope))
    .map((file) => ({ path: file.path, reason: 'excluded-by-regrade-scope' }));
  const occurrences = scopedFiles.flatMap((file) => {
    const deferredOccurrences = deferredOccurrencesForFile(
      file,
      params.plan,
      targetForms
    );
    return [
      ...occurrencesForFile(
        file,
        params.plan,
        targetForms,
        deferredOccurrences
      ),
      ...deferredOccurrences,
    ];
  });
  const occurrencesByPath = new Map<string, SourceOccurrence[]>();
  for (const occurrence of occurrences) {
    const existing = occurrencesByPath.get(occurrence.path) ?? [];
    occurrencesByPath.set(occurrence.path, [...existing, occurrence]);
  }
  const entries = [...occurrencesByPath.entries()]
    .flatMap(([path, pathOccurrences]) => {
      const entry = entryForOccurrences(path, pathOccurrences);
      return entry === null ? [] : [entry];
    })
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const rewrittenPaths = new Set(
    occurrences
      .filter((occurrence) => occurrence.verdict === 'modified')
      .map((occurrence) => occurrence.path)
  );
  const deferredForms = uniqueSorted(
    occurrences
      .filter((occurrence) => occurrence.verdict === 'deferred')
      .map((occurrence) => occurrence.form)
  );
  const modifiedOccurrences = occurrences.filter(
    (occurrence) => occurrence.verdict === 'modified'
  );
  const skippedOccurrences = occurrences.filter(
    (occurrence) => occurrence.verdict === 'skipped'
  );
  const deferredOccurrences = occurrences.filter(
    (occurrence) => occurrence.verdict === 'deferred'
  );
  const unresolvedOccurrences = occurrences.filter(
    (occurrence) =>
      occurrence.verdict === 'modified' || occurrence.verdict === 'deferred'
  );
  const forms: Record<string, VocabularyVerdict> = {};
  for (const occurrence of occurrences) {
    const current = forms[occurrence.form];
    if (occurrence.verdict === 'deferred') {
      forms[occurrence.form] = 'deferred';
      continue;
    }
    if (occurrence.verdict === 'modified' && current !== 'deferred') {
      forms[occurrence.form] = 'modified';
      continue;
    }
    if (current === undefined) {
      forms[occurrence.form] = 'skipped';
    }
  }
  const gateReasons: string[] = [];
  if (modifiedOccurrences.length > 0) {
    gateReasons.push(
      params.apply === true
        ? 'source-forms-remain-after-apply'
        : 'safe-modifications-not-yet-applied'
    );
  }
  if (deferredForms.length > 0) {
    gateReasons.push('deferred-forms-or-occurrences');
  }
  const open = unresolvedOccurrences.length;

  return {
    entries: [
      ...entries,
      ...params.skipped.map((entry) => ({
        outcome: 'skip' as const,
        path: entry.path,
        reason: entry.reason,
      })),
      ...scopeSkipped.map((entry) => ({
        outcome: 'skip' as const,
        path: entry.path,
        reason: entry.reason,
      })),
    ].toSorted((left, right) => left.path.localeCompare(right.path)),
    occurrences,
    run: {
      ledger: {
        cycle: 1,
        forms,
        occurrences: occurrences.map(
          ({ absolutePath: _absolutePath, ...occurrence }) => occurrence
        ),
      },
      plan: params.plan,
      report: {
        applied: params.apply === true ? modifiedOccurrences.length : 0,
        deferred: deferredOccurrences.length,
        dispositions: vocabularyDispositionCounts(occurrences),
        filesChanged: params.apply === true ? rewrittenPaths.size : 0,
        gate: {
          reasons: gateReasons,
          remaining: open,
          remainingByDisposition: vocabularyDispositionCounts(
            unresolvedOccurrences
          ),
          status: gateReasons.length === 0 ? 'green' : 'open',
        },
        modified: modifiedOccurrences.length,
        open,
        skipped: skippedOccurrences.length,
      },
    },
    scanned: scopedFiles.length,
    skipped: [...params.skipped, ...scopeSkipped],
  };
};

const skippedByReason = (
  skipped: readonly SkippedSource[]
): Readonly<Record<string, number>> => {
  const counts = new Map<string, number>();
  for (const entry of skipped) {
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].toSorted(([left], [right]) =>
      left.localeCompare(right)
    )
  );
};

const withApplySummary = (
  report: RegradeReport,
  apply: RegradeApplySummary
): RegradeReport => ({
  ...report,
  apply,
});

const applyVocabularyEvaluation = (
  files: readonly SourceFile[],
  evaluation: VocabularyEvaluation
): Result<RegradeApplySummary, InternalError> => {
  const changedFiles = new Set<string>();
  let applied = 0;
  for (const file of files) {
    const fileOccurrences = evaluation.occurrences.filter(
      (occurrence) =>
        occurrence.path === file.path && occurrence.verdict === 'modified'
    );
    if (fileOccurrences.length === 0) {
      continue;
    }
    const nextSource = applyOccurrenceRewrites(file, fileOccurrences);
    if (nextSource === file.source) {
      continue;
    }
    try {
      writeFileSync(file.absolutePath, nextSource, 'utf8');
    } catch (error: unknown) {
      return Result.err(
        new InternalError(
          `Failed to apply vocabulary regrade rewrite for "${file.path}".`,
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            context: {
              applied,
              filesChanged: changedFiles.size,
              path: file.path,
            },
          }
        )
      );
    }
    applied += fileOccurrences.length;
    changedFiles.add(file.path);
  }

  const reviewFiles = new Set(
    evaluation.occurrences
      .filter((occurrence) => occurrence.verdict === 'deferred')
      .map((occurrence) => occurrence.path)
  );
  const skippedOccurrences = evaluation.occurrences.filter(
    (occurrence) => occurrence.verdict === 'skipped'
  );

  return Result.ok({
    applied,
    filesChanged: changedFiles.size,
    review: reviewFiles.size,
    skipped: skippedOccurrences.length + evaluation.skipped.length,
    unknown: 0,
  });
};

export const runVocabularyRegrade = (params: {
  readonly apply?: boolean;
  readonly includeEntries?: 'actionable' | 'all';
  readonly plan: VocabularyRegradePlan;
  readonly root: string;
}): Result<RegradeReport | null, InternalError | ValidationError> => {
  const planValidation = validateVocabularyPlan(params.plan);
  if (planValidation.isErr()) {
    return planValidation;
  }

  const collected = collectDownstreamSources(params.root, {
    extensions: params.plan.scope?.extensions ?? VOCABULARY_SOURCE_EXTENSIONS,
    ...(params.plan.scope?.exclude === undefined
      ? {}
      : { exclude: params.plan.scope.exclude }),
    ...(params.plan.scope?.ignoredDirectories === undefined
      ? {}
      : { ignoredDirectories: params.plan.scope.ignoredDirectories }),
  } satisfies DownstreamCollectionOptions);
  if (collected === null) {
    return Result.ok(null);
  }

  const files: SourceFile[] = [];
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

  const dryRunEvaluation = buildVocabularyEvaluation({
    apply: false,
    files,
    plan: params.plan,
    root: params.root,
    skipped,
  });
  let reportEvaluation = dryRunEvaluation;
  let applySummary: RegradeApplySummary | undefined;

  if (params.apply === true) {
    const applyResult = applyVocabularyEvaluation(files, dryRunEvaluation);
    if (applyResult.isErr()) {
      return applyResult;
    }
    applySummary = applyResult.value;
    const appliedFiles = files.map((file) => ({
      ...file,
      source: readFileSync(file.absolutePath, 'utf8'),
    }));
    reportEvaluation = buildVocabularyEvaluation({
      apply: true,
      files: appliedFiles,
      plan: params.plan,
      root: params.root,
      skipped,
    });
  }

  const entrySelection = params.includeEntries ?? 'actionable';
  const reportEntries = reportEvaluation.entries;
  const actionableEntries = reportEntries.filter(
    (entry) => entry.outcome === 'rewrite' || entry.outcome === 'needs-review'
  );
  const reportSkippedByReason = skippedByReason(reportEvaluation.skipped);
  const report: RegradeReport = {
    entries: entrySelection === 'all' ? reportEntries : actionableEntries,
    matched: actionableEntries.length,
    review: reportEntries.filter((entry) => entry.outcome === 'needs-review')
      .length,
    rewritten: reportEntries.filter((entry) => entry.outcome === 'rewrite')
      .length,
    root: collected.root,
    run:
      applySummary === undefined
        ? reportEvaluation.run
        : {
            ...reportEvaluation.run,
            report: {
              ...reportEvaluation.run.report,
              applied: applySummary.applied,
              filesChanged: applySummary.filesChanged,
            },
          },
    scan: buildRegradeScanSummary({
      matchedPaths: actionableEntries.map((entry) => entry.path),
      occurrencePaths: reportEvaluation.occurrences.map(
        (occurrence) => occurrence.path
      ),
      scanned: reportEvaluation.scanned,
      skipped: reportEvaluation.skipped.length,
      skippedByReason: reportSkippedByReason,
    }),
    scanned: reportEvaluation.scanned,
    selectedClassIds: [
      params.plan.id ?? `vocabulary:${params.plan.from}->${params.plan.to}`,
    ],
    skipped: reportEvaluation.skipped.length,
    skipsByReason: reportSkippedByReason,
    unknownClassIds: [],
  };

  return Result.ok(
    applySummary === undefined ? report : withApplySummary(report, applySummary)
  );
};

const vocabularyPreserveRuleSchema = z.object({
  disposition: z
    .enum(vocabularyDispositionValues)
    .optional()
    .describe('Classification for occurrences preserved by this rule'),
  paths: z
    .array(z.string())
    .optional()
    .describe('Root-relative path patterns where the preserve rule applies'),
  pattern: z.string().describe('Regex or literal pattern to preserve'),
  reason: z.string().optional().describe('Why this form is preserved'),
});

const vocabularyDispositionCountSchema = z.object(
  Object.fromEntries(
    vocabularyDispositionValues.map((disposition) => [
      disposition,
      z.number().optional(),
    ])
  ) as Record<VocabularyDisposition, z.ZodOptional<z.ZodNumber>>
);

const vocabularyRegradeScopeSchema = z.object({
  exclude: z
    .array(z.string())
    .optional()
    .describe('Root-relative path patterns to exclude from this regrade'),
  extensions: z
    .array(z.string())
    .optional()
    .describe('Source file extensions to scan for this regrade'),
  ignoredDirectories: z
    .array(z.string())
    .optional()
    .describe(
      'Deprecated compatibility override for legacy plans. Use exclude globs for new plans.'
    ),
  include: z
    .array(z.string())
    .optional()
    .describe('Root-relative path patterns to include in this regrade'),
});

export const vocabularyRegradePlanSchema = z.object({
  caseSensitive: z
    .boolean()
    .optional()
    .describe('Whether source form scanning preserves case exactly'),
  deferForms: z
    .array(z.string().min(1))
    .optional()
    .describe('Known forms that must be inventoried for review, not rewritten'),
  from: z.string().min(1).describe('Source vocabulary term or phrase'),
  id: z.string().optional().describe('Stable authored regrade plan id'),
  intent: z.string().optional().describe('Human-authored migration intent'),
  kind: z.literal('vocabulary').describe('Regrade plan kind'),
  overrides: z
    .record(z.string().min(1), z.string().min(1))
    .optional()
    .describe('Explicit source-form to target-form mappings'),
  preserve: z
    .array(vocabularyPreserveRuleSchema)
    .optional()
    .describe('Forms or contexts that are intentionally preserved'),
  scope: vocabularyRegradeScopeSchema
    .optional()
    .describe('Source scope for this regrade plan'),
  to: z.string().min(1).describe('Target vocabulary term or phrase'),
});

export const vocabularyRegradeRunOutput = z.object({
  ledger: z
    .object({
      cycle: z.number().describe('Observed regrade run cycle'),
      forms: z
        .record(z.string(), z.enum(['deferred', 'modified', 'skipped']))
        .describe('Observed per-form triage verdicts for this run'),
      occurrences: z
        .array(
          z.object({
            column: z.number().describe('One-based source column'),
            context: z.string().describe('Source-line context'),
            disposition: z
              .enum(vocabularyDispositionValues)
              .describe('Occurrence-level classification beside the verdict'),
            end: z.number().describe('Source end offset'),
            form: z.string().describe('Matched vocabulary form'),
            line: z.number().describe('One-based source line'),
            path: z.string().describe('Root-relative POSIX path'),
            reason: z.string().describe('Why the occurrence got this verdict'),
            replacement: z
              .string()
              .optional()
              .describe('Replacement text for modified verdicts'),
            start: z.number().describe('Source start offset'),
            verdict: z
              .enum(['deferred', 'modified', 'skipped'])
              .describe('Occurrence-level verdict'),
          })
        )
        .describe('Observed occurrence-level ledger for this run'),
    })
    .describe('Observed run ledger'),
  plan: vocabularyRegradePlanSchema.describe('Authored regrade plan'),
  report: z
    .object({
      applied: z.number().describe('Modified occurrences applied to disk'),
      deferred: z.number().describe('Deferred occurrence count'),
      dispositions: z
        .object(vocabularyDispositionCountSchema.shape)
        .describe('Occurrence counts grouped by disposition'),
      filesChanged: z.number().describe('Distinct files changed on disk'),
      gate: z
        .object({
          reasons: z.array(z.string()).describe('Open-gate reasons'),
          remaining: z.number().describe('Unresolved occurrence count'),
          remainingByDisposition: z
            .object(vocabularyDispositionCountSchema.shape)
            .describe('Unresolved occurrence counts grouped by disposition'),
          status: z
            .enum(['green', 'open'])
            .describe('Whether the run is complete'),
        })
        .describe('Completion gate derived from the run ledger'),
      modified: z.number().describe('Modified occurrence count'),
      open: z
        .number()
        .describe(
          'Deferred or unapplied modified occurrences holding the gate open'
        ),
      skipped: z.number().describe('Skipped occurrence count'),
    })
    .describe('Projected run report'),
});
