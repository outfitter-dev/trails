import {
  InternalError,
  Result,
  ValidationError,
  escapeRegExp,
  matchesAnyPathGlob,
} from '@ontrails/core';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  readonly forms?: readonly string[];
  readonly pattern: string;
  readonly reason?: string;
  readonly paths?: readonly string[];
}

export interface VocabularyPreserveInventoryEntry extends VocabularyPreserveRule {
  readonly evidence: readonly string[];
  readonly source: 'derived-live-api';
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
  readonly preserveInventory?: readonly VocabularyPreserveInventoryEntry[];
  readonly report: VocabularyRunReport;
}

export const VOCABULARY_TRANSITION_RECORD_SCHEMA_VERSION = 1;

export interface VocabularyTransitionRecordEnvironment {
  readonly commitSha?: string;
  readonly engineVersion?: string;
  readonly graphHash?: string;
  readonly root: string;
}

export interface VocabularyTransitionRecord {
  readonly environment: VocabularyTransitionRecordEnvironment;
  readonly kind: 'vocabulary-transition-record';
  readonly recordPath: string;
  readonly report: Omit<RegradeReport, 'record'>;
  readonly schemaVersion: typeof VOCABULARY_TRANSITION_RECORD_SCHEMA_VERSION;
  readonly transition: {
    readonly from: string;
    readonly id: string;
    readonly to: string;
  };
}

export interface VocabularyTransitionRecordSummary {
  readonly path: string;
  readonly schemaVersion: typeof VOCABULARY_TRANSITION_RECORD_SCHEMA_VERSION;
  readonly status: 'candidate' | 'applied' | 'checked';
}

interface SourceFile {
  readonly absolutePath: string;
  readonly path: string;
  readonly source: string;
}

interface SourceOccurrence extends VocabularyOccurrence {
  readonly absolutePath: string;
}

interface SourceOccurrenceDraft extends Omit<
  SourceOccurrence,
  'disposition' | 'reason' | 'verdict'
> {
  readonly contextColumn: number;
}

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

const contextDetailsForOffset = (
  source: string,
  start: number,
  end: number
): { readonly context: string; readonly contextColumn: number } => {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const nextLine = source.indexOf('\n', end);
  const lineEnd = nextLine === -1 ? source.length : nextLine;
  const rawLine = source.slice(lineStart, lineEnd);
  const leadingTrimmed = rawLine.length - rawLine.trimStart().length;
  return {
    context: rawLine.trim(),
    contextColumn: start - lineStart - leadingTrimmed + 1,
  };
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

const isSimpleVocabularyWord = (value: string): boolean =>
  /^[A-Za-z]+$/.test(value);

const endsWithConsonantY = (value: string): boolean => {
  const penultimate = value.at(-2);
  return (
    value.endsWith('y') &&
    penultimate !== undefined &&
    !/[aeiou]/.test(penultimate)
  );
};

const pluralize = (value: string): string => {
  const lower = value.toLowerCase();
  let lowerForm: string;
  if (endsWithConsonantY(lower)) {
    lowerForm = `${lower.slice(0, -1)}ies`;
  } else if (
    lower.endsWith('s') ||
    lower.endsWith('x') ||
    lower.endsWith('ch')
  ) {
    lowerForm = `${lower}es`;
  } else {
    lowerForm = `${lower}s`;
  }
  return preserveCase(value, lowerForm);
};

const pastTenseForm = (value: string): string => {
  const lower = value.toLowerCase();
  let lowerForm: string;
  if (endsWithConsonantY(lower)) {
    lowerForm = `${lower.slice(0, -1)}ied`;
  } else if (lower.endsWith('e')) {
    lowerForm = `${lower}d`;
  } else {
    lowerForm = `${lower}ed`;
  }
  return preserveCase(value, lowerForm);
};

const presentParticipleForm = (value: string): string => {
  const lower = value.toLowerCase();
  let lowerForm: string;
  if (lower.endsWith('ie')) {
    lowerForm = `${lower.slice(0, -2)}ying`;
  } else if (lower.endsWith('e') && !lower.endsWith('ee')) {
    lowerForm = `${lower.slice(0, -1)}ing`;
  } else {
    lowerForm = `${lower}ing`;
  }
  return preserveCase(value, lowerForm);
};

const defaultDeferredVocabularyForms = (from: string): readonly string[] => {
  if (!isSimpleVocabularyWord(from)) {
    return [];
  }
  return uniqueSorted([
    pastTenseForm(from),
    presentParticipleForm(from),
  ]).filter((form) => form !== from && form !== pluralize(from));
};

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

const formIdentityForPlan = (
  plan: VocabularyRegradePlan,
  form: string
): string => (plan.caseSensitive === true ? form : form.toLowerCase());

const targetFormsForPlan = (
  plan: VocabularyRegradePlan
): Map<string, string> => {
  const forms = defaultVocabularyForms(plan.from, plan.to);
  for (const [form, replacement] of normalizedOverrideEntries(plan.overrides)) {
    forms.set(form, replacement);
  }
  return forms;
};

const deferFormsForPlan = (plan: VocabularyRegradePlan): readonly string[] => {
  const overrideForms = new Set(
    normalizedOverrideEntries(plan.overrides).map(([form]) =>
      formIdentityForPlan(plan, form)
    )
  );
  return uniqueSorted([
    ...defaultDeferredVocabularyForms(plan.from).filter(
      (form) => !overrideForms.has(formIdentityForPlan(plan, form))
    ),
    ...(plan.deferForms ?? []),
  ]);
};

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
    if (rule.forms?.some((form) => form.trim().length === 0) === true) {
      return Result.err(
        new ValidationError(
          'Vocabulary Regrade plan preserve forms cannot be empty.'
        )
      );
    }
  }
  return Result.ok();
};

const validatePreserveInventory = (
  inventory: readonly VocabularyPreserveInventoryEntry[] | undefined
): Result<void, ValidationError> => {
  for (const entry of inventory ?? []) {
    if (entry.pattern.trim().length === 0) {
      return Result.err(
        new ValidationError(
          'Vocabulary Regrade preserve inventory patterns cannot be empty.'
        )
      );
    }
    if (entry.forms?.some((form) => form.trim().length === 0) === true) {
      return Result.err(
        new ValidationError(
          'Vocabulary Regrade preserve inventory forms cannot be empty.'
        )
      );
    }
    if (
      entry.disposition !== undefined &&
      !vocabularyDispositions.has(entry.disposition)
    ) {
      return Result.err(
        new ValidationError(
          `Vocabulary Regrade preserve inventory disposition "${entry.disposition}" is not supported.`
        )
      );
    }
    if (entry.evidence.length === 0) {
      return Result.err(
        new ValidationError(
          'Vocabulary Regrade preserve inventory entries need evidence.'
        )
      );
    }
  }
  return Result.ok();
};

const effectivePlanForRun = (
  plan: VocabularyRegradePlan,
  preserveInventory: readonly VocabularyPreserveInventoryEntry[] | undefined
): VocabularyRegradePlan => {
  if (preserveInventory === undefined || preserveInventory.length === 0) {
    return plan;
  }

  return {
    ...plan,
    preserve: [...(plan.preserve ?? []), ...preserveInventory],
  };
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

const globalPreservePattern = (pattern: RegExp): RegExp => {
  const flags = pattern.flags.includes('g')
    ? pattern.flags
    : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
};

const patternOverlapsOccurrence = (
  pattern: RegExp,
  occurrence: SourceOccurrenceDraft
): boolean => {
  const occurrenceStart = occurrence.contextColumn - 1;
  const occurrenceEnd = occurrenceStart + occurrence.form.length;

  for (const match of occurrence.context.matchAll(
    globalPreservePattern(pattern)
  )) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    if (
      matchStart !== matchEnd &&
      occurrenceStart < matchEnd &&
      matchStart < occurrenceEnd
    ) {
      return true;
    }
  }

  return false;
};

const preserveRuleForOccurrence = (
  occurrence: SourceOccurrenceDraft,
  plan: VocabularyRegradePlan
): VocabularyPreserveRule | undefined =>
  plan.preserve?.find((rule) => {
    if (rule.forms !== undefined && !rule.forms.includes(occurrence.form)) {
      return false;
    }
    if (
      rule.paths !== undefined &&
      !matchesAnyPathGlob(occurrence.path, rule.paths)
    ) {
      return false;
    }
    const pattern = compilePreservePattern(rule.pattern);
    if (
      pattern.test(occurrence.form) ||
      patternOverlapsOccurrence(pattern, occurrence)
    ) {
      return true;
    }
    return rule.forms === undefined && pattern.test(occurrence.context);
  });

const occurrenceOverlaps = (
  occurrences: readonly {
    readonly end: number;
    readonly start: number;
  }[],
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
  const context = contextDetailsForOffset(file.source, start, end);
  return {
    absolutePath: file.absolutePath,
    column,
    context: context.context,
    contextColumn: context.contextColumn,
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
    absolutePath: baseOccurrence.absolutePath,
    column: baseOccurrence.column,
    context: baseOccurrence.context,
    disposition: vocabularyOccurrenceDisposition(
      verdict,
      preserveRule,
      markdownCodeContext
    ),
    end: baseOccurrence.end,
    form: baseOccurrence.form,
    line: baseOccurrence.line,
    path: baseOccurrence.path,
    reason: vocabularyOccurrenceReason(
      preserveRule,
      markdownCodeContext,
      reason
    ),
    start: baseOccurrence.start,
    verdict,
  };
};

const exactDeferredFormOccurrencesForFile = (
  file: SourceFile,
  plan: VocabularyRegradePlan,
  deferForms: readonly string[],
  targetFormSpans: readonly {
    readonly end: number;
    readonly start: number;
  }[]
): readonly SourceOccurrence[] => {
  const occurrences: SourceOccurrence[] = [];
  const authoredDeferForms = new Set(
    (plan.deferForms ?? []).map((form) => formIdentityForPlan(plan, form))
  );
  for (const form of deferForms) {
    const pattern = new RegExp(escapeRegExp(form), vocabularyScanFlags(plan));
    for (const match of file.source.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const isAuthoredDefer = authoredDeferForms.has(
        formIdentityForPlan(plan, form)
      );
      if (
        !hasWordBoundary(file.source, start, end) ||
        occurrenceOverlaps(occurrences, start, end) ||
        (!isAuthoredDefer && occurrenceOverlaps(targetFormSpans, start, end))
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

const targetFormSpansForFile = (
  file: SourceFile,
  plan: VocabularyRegradePlan,
  targetForms: Map<string, string>
): readonly {
  readonly end: number;
  readonly start: number;
}[] => {
  const spans: { end: number; start: number }[] = [];
  for (const form of targetForms.keys()) {
    const pattern = new RegExp(escapeRegExp(form), vocabularyScanFlags(plan));
    for (const match of file.source.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (
        !hasWordBoundary(file.source, start, end) ||
        occurrenceOverlaps(spans, start, end)
      ) {
        continue;
      }
      spans.push({ end, start });
    }
  }
  return spans;
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
      const context = contextDetailsForOffset(file.source, start, end);
      const baseOccurrence = {
        absolutePath: file.absolutePath,
        column,
        context: context.context,
        contextColumn: context.contextColumn,
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
        absolutePath: baseOccurrence.absolutePath,
        column: baseOccurrence.column,
        context: baseOccurrence.context,
        disposition: vocabularyOccurrenceDisposition(
          verdict,
          preserveRule,
          markdownCodeContext
        ),
        end: baseOccurrence.end,
        form: baseOccurrence.form,
        line: baseOccurrence.line,
        path: baseOccurrence.path,
        reason: vocabularyOccurrenceReason(
          preserveRule,
          markdownCodeContext,
          'captured-form'
        ),
        ...(preserveRule === undefined && !markdownCodeContext
          ? { replacement: preserveCase(match[0], replacement) }
          : {}),
        start: baseOccurrence.start,
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
  const targetFormSpans = targetFormSpansForFile(file, plan, targetForms);
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
    ...exactDeferredFormOccurrencesForFile(
      file,
      plan,
      deferForms,
      targetFormSpans
    ),
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
  readonly effectivePlan?: VocabularyRegradePlan | undefined;
  readonly files: readonly SourceFile[];
  readonly plan: VocabularyRegradePlan;
  readonly preserveInventory?: readonly VocabularyPreserveInventoryEntry[];
  readonly root: string;
  readonly skipped: readonly SkippedSource[];
}): VocabularyEvaluation => {
  const effectivePlan = params.effectivePlan ?? params.plan;
  const targetForms = targetFormsForPlan(effectivePlan);
  const scopedFiles = params.files.filter((file) =>
    includedByScope(file.path, effectivePlan.scope)
  );
  const scopeSkipped: SkippedSource[] = params.files
    .filter((file) => !includedByScope(file.path, effectivePlan.scope))
    .map((file) => ({ path: file.path, reason: 'excluded-by-regrade-scope' }));
  const occurrences = scopedFiles.flatMap((file) => {
    const deferredOccurrences = deferredOccurrencesForFile(
      file,
      effectivePlan,
      targetForms
    );
    return [
      ...occurrencesForFile(
        file,
        effectivePlan,
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
      ...(params.preserveInventory === undefined ||
      params.preserveInventory.length === 0
        ? {}
        : { preserveInventory: params.preserveInventory }),
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

const readVocabularySourceFiles = (
  collected: NonNullable<ReturnType<typeof collectDownstreamSources>>
): {
  readonly files: readonly SourceFile[];
  readonly skipped: readonly SkippedSource[];
} => {
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
  return { files, skipped };
};

const buildRunVocabularyEvaluation = (params: {
  readonly apply: boolean;
  readonly effectivePlan: VocabularyRegradePlan;
  readonly files: readonly SourceFile[];
  readonly plan: VocabularyRegradePlan;
  readonly preserveInventory:
    | readonly VocabularyPreserveInventoryEntry[]
    | undefined;
  readonly root: string;
  readonly skipped: readonly SkippedSource[];
}): VocabularyEvaluation =>
  buildVocabularyEvaluation({
    apply: params.apply,
    effectivePlan: params.effectivePlan,
    files: params.files,
    plan: params.plan,
    ...(params.preserveInventory === undefined
      ? {}
      : { preserveInventory: params.preserveInventory }),
    root: params.root,
    skipped: params.skipped,
  });

export const runVocabularyRegrade = (params: {
  readonly apply?: boolean;
  readonly includeEntries?: 'actionable' | 'all';
  readonly plan: VocabularyRegradePlan;
  readonly preserveInventory?: readonly VocabularyPreserveInventoryEntry[];
  readonly root: string;
}): Result<RegradeReport | null, InternalError | ValidationError> => {
  const planValidation = validateVocabularyPlan(params.plan);
  if (planValidation.isErr()) {
    return planValidation;
  }
  const inventoryValidation = validatePreserveInventory(
    params.preserveInventory
  );
  if (inventoryValidation.isErr()) {
    return inventoryValidation;
  }

  const effectivePlan = effectivePlanForRun(
    params.plan,
    params.preserveInventory
  );

  const collected = collectDownstreamSources(params.root, {
    extensions: effectivePlan.scope?.extensions ?? VOCABULARY_SOURCE_EXTENSIONS,
    ...(effectivePlan.scope?.exclude === undefined
      ? {}
      : { exclude: effectivePlan.scope.exclude }),
    ...(effectivePlan.scope?.include === undefined
      ? {}
      : { include: effectivePlan.scope.include }),
    ...(effectivePlan.scope?.ignoredDirectories === undefined
      ? {}
      : { ignoredDirectories: effectivePlan.scope.ignoredDirectories }),
  } satisfies DownstreamCollectionOptions);
  if (collected === null) {
    return Result.ok(null);
  }

  const { files, skipped } = readVocabularySourceFiles(collected);

  const dryRunEffectiveEvaluation = buildRunVocabularyEvaluation({
    apply: false,
    effectivePlan,
    files,
    plan: params.plan,
    preserveInventory: params.preserveInventory,
    root: params.root,
    skipped,
  });
  let reportEvaluation = dryRunEffectiveEvaluation;
  let applySummary: RegradeApplySummary | undefined;

  if (params.apply === true) {
    const applyResult = applyVocabularyEvaluation(
      files,
      dryRunEffectiveEvaluation
    );
    if (applyResult.isErr()) {
      return applyResult;
    }
    applySummary = applyResult.value;
    const appliedFiles = files.map((file) => ({
      ...file,
      source: readFileSync(file.absolutePath, 'utf8'),
    }));
    reportEvaluation = buildRunVocabularyEvaluation({
      apply: true,
      effectivePlan,
      files: appliedFiles,
      plan: params.plan,
      preserveInventory: params.preserveInventory,
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
  forms: z
    .array(z.string().min(1))
    .optional()
    .describe('Matched forms this preserve rule applies to'),
  paths: z
    .array(z.string())
    .optional()
    .describe('Root-relative path patterns where the preserve rule applies'),
  pattern: z.string().describe('Regex or literal pattern to preserve'),
  reason: z.string().optional().describe('Why this form is preserved'),
});

const vocabularyPreserveInventoryEntrySchema =
  vocabularyPreserveRuleSchema.extend({
    evidence: z
      .array(z.string().min(1))
      .describe('Graph or surface facts that justify this derived preserve'),
    source: z.literal('derived-live-api').describe('Derived inventory source'),
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
  preserveInventory: z
    .array(vocabularyPreserveInventoryEntrySchema)
    .optional()
    .describe(
      'Derived live-API preserve inventory applied at run time without changing the authored plan'
    ),
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

const vocabularyTransitionRecordEnvironmentSchema = z
  .object({
    commitSha: z.string().optional(),
    engineVersion: z.string().optional(),
    graphHash: z.string().optional(),
    root: z.string(),
  })
  .strict();

const vocabularyTransitionRecordReportSchema = z
  .object({
    apply: z.unknown().optional(),
    entries: z.array(z.unknown()),
    matched: z.number(),
    review: z.number(),
    rewritten: z.number(),
    root: z.string(),
    run: vocabularyRegradeRunOutput,
    scan: z.unknown(),
    scanned: z.number(),
    selectedClassIds: z.array(z.string()),
    skipped: z.number(),
    skipsByReason: z.record(z.string(), z.number()),
    unknownClassIds: z.array(z.string()),
  })
  .strict();

const normalizeTransitionRecordPath = (path: string): string =>
  normalize(path).replaceAll('\\', '/');

const isSafeRootRelativeRecordPath = (path: string): boolean => {
  const normalized = normalizeTransitionRecordPath(path);
  return (
    normalized.length > 0 &&
    !isAbsolute(normalized) &&
    normalized !== '..' &&
    !normalized.startsWith('../')
  );
};

export const vocabularyTransitionRecordSchema = z
  .object({
    environment: vocabularyTransitionRecordEnvironmentSchema,
    kind: z.literal('vocabulary-transition-record'),
    recordPath: z.string().refine(isSafeRootRelativeRecordPath),
    report: vocabularyTransitionRecordReportSchema,
    schemaVersion: z.literal(VOCABULARY_TRANSITION_RECORD_SCHEMA_VERSION),
    transition: z
      .object({
        from: z.string(),
        id: z.string(),
        to: z.string(),
      })
      .strict(),
  })
  .strict();

const transitionRecordSlug = (run: VocabularyRegradeRun): string =>
  `${run.plan.from}-to-${run.plan.to}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, nested) => {
    if (
      nested === null ||
      typeof nested !== 'object' ||
      Array.isArray(nested)
    ) {
      return nested as unknown;
    }
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).toSorted(
        ([left], [right]) => left.localeCompare(right)
      )
    );
  });

const shortHashForRun = (
  run: VocabularyRegradeRun,
  environment?: Partial<VocabularyTransitionRecordEnvironment>
): string => {
  const explicitHash = environment?.graphHash ?? environment?.commitSha;
  if (explicitHash !== undefined && explicitHash.length > 0) {
    return explicitHash.slice(0, 7);
  }
  return createHash('sha256')
    .update(stableJson({ ledger: run.ledger, plan: run.plan }))
    .digest('hex')
    .slice(0, 7);
};

export const vocabularyTransitionRecordPath = (params: {
  readonly environment?: Partial<VocabularyTransitionRecordEnvironment>;
  readonly root: string;
  readonly run: VocabularyRegradeRun;
}): string =>
  join(
    '.trails',
    'regrade',
    'history',
    `${transitionRecordSlug(params.run)}-${shortHashForRun(params.run, params.environment)}.json`
  );

const reportWithoutRecord = (
  report: RegradeReport
): Omit<RegradeReport, 'record'> => {
  const { record: _record, ...rest } = report;
  return rest;
};

const transitionRecordPathForWrite = (params: {
  readonly environment: VocabularyTransitionRecordEnvironment;
  readonly recordPath?: string;
  readonly report: RegradeReport;
  readonly root: string;
}): Result<string, ValidationError> => {
  const recordPath =
    params.recordPath ??
    vocabularyTransitionRecordPath({
      environment: params.environment,
      root: params.root,
      run: params.report.run as VocabularyRegradeRun,
    });
  const normalized = normalizeTransitionRecordPath(
    isAbsolute(recordPath) ? relative(params.root, recordPath) : recordPath
  );
  if (!isSafeRootRelativeRecordPath(normalized)) {
    return Result.err(
      new ValidationError(
        'Vocabulary transition record path must stay inside the regrade root.',
        { context: { recordPath } }
      )
    );
  }
  return Result.ok(normalized);
};

export const buildVocabularyTransitionRecord = (params: {
  readonly environment?: Partial<VocabularyTransitionRecordEnvironment>;
  readonly recordPath?: string;
  readonly report: RegradeReport;
  readonly root: string;
}): Result<VocabularyTransitionRecord, ValidationError> => {
  if (params.report.run === undefined) {
    return Result.err(
      new ValidationError(
        'Vocabulary transition records require a vocabulary Regrade report.'
      )
    );
  }

  const environment: VocabularyTransitionRecordEnvironment = {
    ...(params.environment?.commitSha === undefined
      ? {}
      : { commitSha: params.environment.commitSha }),
    ...(params.environment?.engineVersion === undefined
      ? {}
      : { engineVersion: params.environment.engineVersion }),
    ...(params.environment?.graphHash === undefined
      ? {}
      : { graphHash: params.environment.graphHash }),
    root: params.root,
  };
  const recordPathResult = transitionRecordPathForWrite({
    environment,
    report: params.report,
    root: params.root,
    ...(params.recordPath === undefined
      ? {}
      : { recordPath: params.recordPath }),
  });
  if (recordPathResult.isErr()) {
    return recordPathResult;
  }
  const recordPath = recordPathResult.value;
  const record: VocabularyTransitionRecord = {
    environment,
    kind: 'vocabulary-transition-record',
    recordPath,
    report: reportWithoutRecord(params.report),
    schemaVersion: VOCABULARY_TRANSITION_RECORD_SCHEMA_VERSION,
    transition: {
      from: params.report.run.plan.from,
      id:
        params.report.run.plan.id ??
        `vocabulary:${params.report.run.plan.from}->${params.report.run.plan.to}`,
      to: params.report.run.plan.to,
    },
  };
  const parsed = vocabularyTransitionRecordSchema.safeParse(record);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid vocabulary transition record.', {
        context: { issues: parsed.error.issues },
      })
    );
  }
  return Result.ok(parsed.data as VocabularyTransitionRecord);
};

export const writeVocabularyTransitionRecord = (params: {
  readonly environment?: Partial<VocabularyTransitionRecordEnvironment>;
  readonly recordPath?: string;
  readonly report: RegradeReport;
  readonly root: string;
  readonly status: VocabularyTransitionRecordSummary['status'];
}): Result<
  {
    readonly record: VocabularyTransitionRecord;
    readonly summary: VocabularyTransitionRecordSummary;
  },
  InternalError | ValidationError
> => {
  const recordResult = buildVocabularyTransitionRecord(params);
  if (recordResult.isErr()) {
    return recordResult;
  }
  const record = recordResult.value;
  const absolutePath = isAbsolute(record.recordPath)
    ? record.recordPath
    : join(params.root, record.recordPath);
  try {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    return Result.err(
      new InternalError('Failed to write vocabulary transition record.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path: record.recordPath },
      })
    );
  }
  return Result.ok({
    record,
    summary: {
      path: record.recordPath,
      schemaVersion: record.schemaVersion,
      status: params.status,
    },
  });
};

export const readVocabularyTransitionRecord = (
  path: string
): Result<VocabularyTransitionRecord, InternalError | ValidationError> => {
  if (!existsSync(path)) {
    return Result.err(
      new ValidationError(`Vocabulary transition record "${path}" not found.`)
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return Result.err(
      new InternalError('Failed to read vocabulary transition record.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path },
      })
    );
  }
  const parsed = vocabularyTransitionRecordSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return Result.err(
      new ValidationError('Invalid vocabulary transition record.', {
        context: { issues: parsed.error.issues, path },
      })
    );
  }
  return Result.ok(parsed.data as VocabularyTransitionRecord);
};

export const transitionRecordReportWithSummary = (
  report: RegradeReport,
  summary: VocabularyTransitionRecordSummary
): RegradeReport => ({ ...report, record: summary });
