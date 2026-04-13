/**
 * Warden CLI command runner.
 *
 * Scans TypeScript files, runs all warden rules, optionally checks drift,
 * and returns a structured report.
 */

import { resolve } from 'node:path';

import type { Topo } from '@ontrails/core';
import { getContourReferences } from '@ontrails/core';

import type { DriftResult } from './drift.js';
import { checkDrift } from './drift.js';
import {
  collectContourDefinitionIds,
  collectContourReferenceTargetsByName,
  collectCrossTargetTrailIds,
  collectResourceDefinitionIds,
  collectSignalDefinitionIds,
  collectTrailIntentsById,
  findConfigProperty,
  findTrailDefinitions,
  parse,
  walk,
} from './rules/ast.js';
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
  /** App topology for drift detection. When provided, enables real trailhead lock comparison. */
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
  !match.startsWith('.git/') &&
  !match.includes('__tests__/') &&
  !match.includes('__test__/') &&
  !match.endsWith('.test.ts') &&
  !match.endsWith('.spec.ts');

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

interface MutableProjectContext {
  contourReferencesByName: Map<string, Set<string>>;
  crossTargetTrailIds: Set<string>;
  detourTargetTrailIds: Set<string>;
  knownContourIds: Set<string>;
  knownResourceIds: Set<string>;
  knownSignalIds: Set<string>;
  knownTrailIds: Set<string>;
  trailIntentsById: Map<string, 'destroy' | 'read' | 'write'>;
}

const createMutableProjectContext = (): MutableProjectContext => ({
  contourReferencesByName: new Map<string, Set<string>>(),
  crossTargetTrailIds: new Set<string>(),
  detourTargetTrailIds: new Set<string>(),
  knownContourIds: new Set<string>(),
  knownResourceIds: new Set<string>(),
  knownSignalIds: new Set<string>(),
  knownTrailIds: new Set<string>(),
  trailIntentsById: new Map<string, 'destroy' | 'read' | 'write'>(),
});

const addContourReferenceTargets = (
  context: MutableProjectContext,
  contourName: string,
  targets: readonly string[]
): void => {
  const existing = context.contourReferencesByName.get(contourName);
  if (existing) {
    for (const target of targets) {
      existing.add(target);
    }
    return;
  }

  context.contourReferencesByName.set(contourName, new Set(targets));
};

const toProjectContext = (context: MutableProjectContext): ProjectContext => ({
  ...(context.contourReferencesByName.size > 0
    ? {
        contourReferencesByName: new Map(
          [...context.contourReferencesByName.entries()].map(
            ([name, targets]) => [name, [...targets]]
          )
        ),
      }
    : {}),
  crossTargetTrailIds: context.crossTargetTrailIds,
  detourTargetTrailIds: context.detourTargetTrailIds,
  knownContourIds: context.knownContourIds,
  knownResourceIds: context.knownResourceIds,
  knownSignalIds: context.knownSignalIds,
  knownTrailIds: context.knownTrailIds,
  trailIntentsById: context.trailIntentsById,
});

const collectKnownContourIds = (
  sourceCode: string,
  filePath: string,
  knownContourIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const id of collectContourDefinitionIds(ast)) {
    knownContourIds.add(id);
  }
};

const collectKnownTrailIds = (
  sourceCode: string,
  filePath: string,
  knownTrailIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const def of findTrailDefinitions(ast)) {
    knownTrailIds.add(def.id);
  }
};

const collectDetourTargetTrailIds = (
  sourceCode: string,
  filePath: string,
  detourTargetTrailIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const def of findTrailDefinitions(ast)) {
    const detoursProp = findConfigProperty(def.config, 'detours');
    if (!detoursProp) {
      continue;
    }
    // Walk the detours value for string literals that look like trail IDs
    walk(detoursProp, (node) => {
      if (node.type !== 'Literal') {
        return;
      }
      const val = (node as unknown as { value?: string }).value;
      if (val && val.includes('.')) {
        detourTargetTrailIds.add(val);
      }
    });
  }
};

const collectCrossedTrailIds = (
  sourceCode: string,
  filePath: string,
  crossTargetTrailIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const id of collectCrossTargetTrailIds(ast, sourceCode)) {
    crossTargetTrailIds.add(id);
  }
};

const collectKnownResourceIds = (
  sourceCode: string,
  filePath: string,
  knownResourceIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const id of collectResourceDefinitionIds(ast)) {
    knownResourceIds.add(id);
  }
};

const collectKnownSignalIds = (
  sourceCode: string,
  filePath: string,
  knownSignalIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const id of collectSignalDefinitionIds(ast)) {
    knownSignalIds.add(id);
  }
};

const collectTrailIntents = (
  sourceCode: string,
  filePath: string,
  trailIntentsById: Map<string, 'destroy' | 'read' | 'write'>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const [id, intent] of collectTrailIntentsById(ast)) {
    trailIntentsById.set(id, intent);
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

const collectTopoDetourTargetTrailIds = (
  appTopo: Topo
): ReadonlySet<string> => {
  const detourTargetTrailIds = new Set<string>();

  for (const trail of appTopo.trails.values()) {
    const detours = (trail as unknown as Record<string, unknown>)['detours'] as
      | Readonly<Record<string, readonly string[]>>
      | undefined;
    if (!detours) {
      continue;
    }
    for (const targets of Object.values(detours)) {
      for (const id of targets) {
        detourTargetTrailIds.add(id);
      }
    }
  }

  return detourTargetTrailIds;
};

const collectTopoKnownIds = (
  appTopo: Topo,
  context: MutableProjectContext
): void => {
  for (const name of appTopo.contours.keys()) {
    context.knownContourIds.add(name);
  }

  for (const id of appTopo.trails.keys()) {
    context.knownTrailIds.add(id);
  }

  for (const id of appTopo.resources.keys()) {
    context.knownResourceIds.add(id);
  }

  for (const id of appTopo.signals.keys()) {
    context.knownSignalIds.add(id);
  }
};

const collectTopoDetourIds = (
  appTopo: Topo,
  context: MutableProjectContext
): void => {
  for (const id of collectTopoDetourTargetTrailIds(appTopo)) {
    context.detourTargetTrailIds.add(id);
  }
};

const collectTopoCrossesAndIntents = (
  appTopo: Topo,
  context: MutableProjectContext
): void => {
  for (const trail of appTopo.trails.values()) {
    context.trailIntentsById.set(trail.id, trail.intent);
    for (const crossedTrailId of trail.crosses) {
      context.crossTargetTrailIds.add(crossedTrailId);
    }
  }
};

const collectTopoContourReferences = (
  appTopo: Topo,
  context: MutableProjectContext
): void => {
  for (const contour of appTopo.listContours()) {
    addContourReferenceTargets(
      context,
      contour.name,
      getContourReferences(contour).map((reference) => reference.contour)
    );
  }
};

const collectTopoTrailContext = (
  appTopo: Topo,
  context: MutableProjectContext
): void => {
  collectTopoKnownIds(appTopo, context);
  collectTopoDetourIds(appTopo, context);
  collectTopoCrossesAndIntents(appTopo, context);
  collectTopoContourReferences(appTopo, context);
};

const buildProjectContextFromTopo = (appTopo: Topo): ProjectContext => {
  const context = createMutableProjectContext();
  collectTopoTrailContext(appTopo, context);
  return toProjectContext(context);
};

const collectFileProjectContext = (
  sourceFile: SourceFile,
  context: MutableProjectContext
): void => {
  collectKnownContourIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.knownContourIds
  );
  collectKnownTrailIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.knownTrailIds
  );
  collectKnownResourceIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.knownResourceIds
  );
  collectKnownSignalIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.knownSignalIds
  );
  collectCrossedTrailIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.crossTargetTrailIds
  );
  collectDetourTargetTrailIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.detourTargetTrailIds
  );
  collectTrailIntents(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.trailIntentsById
  );
};

const collectFileContourReferences = (
  sourceFile: SourceFile,
  context: MutableProjectContext
): void => {
  const ast = parse(sourceFile.filePath, sourceFile.sourceCode);
  if (!ast) {
    return;
  }

  const referencesByName = collectContourReferenceTargetsByName(
    ast,
    context.knownContourIds
  );
  for (const [contourName, targets] of referencesByName) {
    addContourReferenceTargets(context, contourName, targets);
  }
};

const buildProjectContextFromFiles = (
  sourceFiles: readonly SourceFile[]
): ProjectContext => {
  const context = createMutableProjectContext();

  for (const sourceFile of sourceFiles) {
    collectFileProjectContext(sourceFile, context);
  }

  for (const sourceFile of sourceFiles) {
    collectFileContourReferences(sourceFile, context);
  }

  return toProjectContext(context);
};

const isProjectAwareRule = (rule: WardenRule): rule is ProjectAwareWardenRule =>
  'checkWithContext' in rule;

/**
 * Lint all files against all warden rules.
 */
const lintFiles = async (
  rootDir: string,
  appTopo?: Topo | undefined
): Promise<WardenDiagnostic[]> => {
  const allDiagnostics: WardenDiagnostic[] = [];
  const sourceFiles = await loadSourceFiles(rootDir);
  const context = appTopo
    ? buildProjectContextFromTopo(appTopo)
    : buildProjectContextFromFiles(sourceFiles);

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
  const allDiagnostics = options.driftOnly
    ? []
    : await lintFiles(rootDir, options.topo);
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
    passed:
      errorCount === 0 &&
      !(drift?.stale ?? false) &&
      drift?.blockedReason === undefined,
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
  if (drift.blockedReason !== undefined) {
    return [`Drift: blocked (${drift.blockedReason})`, ''];
  }
  const label = drift.stale
    ? 'Drift: trails.lock is stale (regenerate with `trails topo export`)'
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
  if (report.drift?.blockedReason !== undefined) {
    parts.push('established exports blocked');
  } else if (report.drift?.stale) {
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
