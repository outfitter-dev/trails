/**
 * Warden CLI command runner.
 *
 * Scans TypeScript files, runs all warden rules, optionally checks drift,
 * and returns a structured report.
 */

import { resolve } from 'node:path';

import type { Topo } from '@ontrails/core';

import type { DriftResult } from './drift.js';
import { checkDrift } from './drift.js';
import { wardenRules } from './rules/index.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
  WardenRule,
} from './rules/types.js';

/**
 * Options for the warden CLI runner.
 */
export interface WardenOptions {
  /** Root directory to scan for TypeScript files. Defaults to cwd. */
  readonly rootDir?: string | undefined;
  /** Only run lint rules, skip drift detection */
  readonly lintOnly?: boolean | undefined;
  /** Only run drift detection, skip lint rules */
  readonly driftOnly?: boolean | undefined;
  /** App topology for drift detection. When provided, enables real surface lock comparison. */
  readonly topo?: Topo | undefined;
}

/**
 * Result of a warden run.
 */
export interface WardenReport {
  /** All diagnostics from lint rules */
  readonly diagnostics: readonly WardenDiagnostic[];
  /** Count of error-severity diagnostics */
  readonly errorCount: number;
  /** Count of warn-severity diagnostics */
  readonly warnCount: number;
  /** Drift detection result, or null if skipped */
  readonly drift: DriftResult | null;
  /** Whether the warden run passed (no errors, no drift) */
  readonly passed: boolean;
}

/**
 * Collect all .ts files under a directory, excluding node_modules, dist, and .git.
 */
const isSourceFile = (match: string): boolean =>
  !match.endsWith('.d.ts') &&
  !match.startsWith('node_modules/') &&
  !match.startsWith('dist/') &&
  !match.startsWith('.git/');

const collectTsFiles = (dir: string): readonly string[] => {
  const glob = new Bun.Glob('**/*.ts');
  let matches: IterableIterator<string>;
  try {
    matches = glob.scanSync({ cwd: dir, dot: false, onlyFiles: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const match of matches) {
    if (isSourceFile(match)) {
      files.push(`${dir}/${match}`);
    }
  }
  return files;
};

interface SourceFile {
  readonly filePath: string;
  readonly sourceCode: string;
}

const collectKnownTrailIds = (
  sourceCode: string,
  knownTrailIds: Set<string>
): void => {
  for (const match of sourceCode.matchAll(
    /\b(?:trail|route)\s*\(\s*["'`]([^"'`]+)["'`]/g
  )) {
    const [, trailId] = match;
    if (trailId) {
      knownTrailIds.add(trailId);
    }
  }
};

const collectDetourTargetTrailIds = (
  sourceCode: string,
  detourTargetTrailIds: Set<string>
): void => {
  for (const block of sourceCode.matchAll(
    /\bdetours\s*:\s*(\{[\s\S]*?\}|\[[\s\S]*?\])/g
  )) {
    const [, detourBody] = block;
    if (!detourBody) {
      continue;
    }
    for (const match of detourBody.matchAll(/["'`]([^"'`]+)["'`]/g)) {
      const [, trailId] = match;
      if (trailId && trailId.includes('.')) {
        detourTargetTrailIds.add(trailId);
      }
    }
  }
};

const loadSourceFiles = async (
  rootDir: string
): Promise<readonly SourceFile[]> => {
  const sourceFiles: SourceFile[] = [];

  for (const filePath of collectTsFiles(rootDir)) {
    try {
      sourceFiles.push({
        filePath,
        sourceCode: await Bun.file(filePath).text(),
      });
    } catch {
      continue;
    }
  }

  return sourceFiles;
};

const buildProjectContext = (
  sourceFiles: readonly SourceFile[]
): ProjectContext => {
  const knownTrailIds = new Set<string>();
  const detourTargetTrailIds = new Set<string>();

  for (const sourceFile of sourceFiles) {
    collectKnownTrailIds(sourceFile.sourceCode, knownTrailIds);
    collectDetourTargetTrailIds(sourceFile.sourceCode, detourTargetTrailIds);
  }

  return {
    detourTargetTrailIds,
    knownTrailIds,
  };
};

const isProjectAwareRule = (rule: WardenRule): rule is ProjectAwareWardenRule =>
  'checkWithContext' in rule;

/**
 * Lint all files against all warden rules.
 */
const lintFiles = async (rootDir: string): Promise<WardenDiagnostic[]> => {
  const allDiagnostics: WardenDiagnostic[] = [];
  const sourceFiles = await loadSourceFiles(rootDir);
  const context = buildProjectContext(sourceFiles);

  for (const sourceFile of sourceFiles) {
    for (const rule of wardenRules.values()) {
      if (isProjectAwareRule(rule)) {
        allDiagnostics.push(
          ...rule.checkWithContext(
            sourceFile.sourceCode,
            sourceFile.filePath,
            context
          )
        );
        continue;
      }

      allDiagnostics.push(
        ...rule.check(sourceFile.sourceCode, sourceFile.filePath)
      );
    }
  }

  return allDiagnostics;
};

/**
 * Run all warden checks and return a structured report.
 */
export const runWarden = async (
  options: WardenOptions = {}
): Promise<WardenReport> => {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const allDiagnostics = options.driftOnly ? [] : await lintFiles(rootDir);
  const drift = options.lintOnly
    ? null
    : await checkDrift(rootDir, options.topo);

  const errorCount = allDiagnostics.filter(
    (d) => d.severity === 'error'
  ).length;
  const warnCount = allDiagnostics.filter((d) => d.severity === 'warn').length;

  return {
    diagnostics: allDiagnostics,
    drift,
    errorCount,
    passed: errorCount === 0 && !(drift?.stale ?? false),
    warnCount,
  };
};

/**
 * Format the lint section of the report.
 */
const formatLintSection = (report: WardenReport): string[] => {
  if (report.diagnostics.length === 0) {
    return ['Lint: clean'];
  }

  const lines = [
    `Lint: ${report.errorCount} errors, ${report.warnCount} warnings`,
  ];

  for (const d of report.diagnostics) {
    const prefix = d.severity === 'error' ? 'ERROR' : 'WARN';
    lines.push(
      `  ${d.filePath}:${String(d.line)}  [${prefix}] ${d.rule}  ${d.message}`
    );
  }

  return lines;
};

/**
 * Format the drift section of the report.
 */
const formatDriftSection = (drift: DriftResult | null): string[] => {
  if (drift === null) {
    return [];
  }
  const label = drift.stale
    ? 'Drift: surface.lock is stale (regenerate with `trails survey generate`)'
    : 'Drift: clean';
  return [label, ''];
};

/**
 * Format the result line.
 */
const formatResultLine = (report: WardenReport): string => {
  if (report.passed) {
    return 'Result: PASS';
  }
  const parts: string[] = [];
  if (report.errorCount > 0) {
    parts.push(`${report.errorCount} errors`);
  }
  if (report.drift?.stale) {
    parts.push('drift detected');
  }
  return `Result: FAIL (${parts.join(', ')})`;
};

/**
 * Format a warden report as a human-readable string.
 */
export const formatWardenReport = (report: WardenReport): string => {
  const lintLines = formatLintSection(report);
  const driftLines = formatDriftSection(report.drift);

  if (lintLines.length === 0 && driftLines.length === 0) {
    return ['Warden Report', '=============', '', 'No checks were run.'].join(
      '\n'
    );
  }

  return [
    'Warden Report',
    '=============',
    '',
    ...lintLines,
    '',
    ...driftLines,
    formatResultLine(report),
  ].join('\n');
};
