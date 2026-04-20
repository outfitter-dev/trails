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
  collectCrudTableIds as collectCrudTableIdsFromAst,
  collectCrossTargetTrailIds,
  collectOnTargetSignalIds as collectOnTargetSignalIdsFromAst,
  collectReconcileTableIds as collectReconcileTableIdsFromAst,
  collectResourceDefinitionIds,
  collectSignalDefinitionIds,
  collectTrailIntentsById,
  findTrailDefinitions,
  parse,
} from './rules/ast.js';
import { collectFileCrudCoverage } from './rules/incomplete-crud.js';
import { wardenRules, wardenTopoRules } from './rules/index.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  TopoAwareWardenRule,
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
  /**
   * App topology for drift detection. When provided, enables real trailhead
   * lock comparison and unlocks the topo-aware rule dispatch path.
   *
   * @remarks
   * Topo-aware rules (both built-in `wardenTopoRules` and `extraTopoRules`)
   * only fire when a `Topo` is supplied. Runs without a topo silently skip
   * topo-aware dispatch — callers that depend on a topo-aware rule firing
   * must pass `topo` explicitly.
   */
  readonly topo?: Topo | undefined;
  /**
   * Extra topo-aware rules to run in addition to the built-in registry.
   *
   * Primarily a test hook — production callers should register rules via
   * `wardenTopoRules` in `rules/index.ts`. These rules are only invoked
   * when `topo` is also supplied (see `topo` remarks).
   */
  readonly extraTopoRules?: readonly TopoAwareWardenRule[] | undefined;
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
  crudTableIds: Set<string>;
  crossTargetTrailIds: Set<string>;
  crudCoverageByEntity: Map<string, Set<string>>;
  detourTargetTrailIds: Set<string>;
  knownContourIds: Set<string>;
  knownResourceIds: Set<string>;
  knownSignalIds: Set<string>;
  knownTrailIds: Set<string>;
  onTargetSignalIds: Set<string>;
  reconcileTableIds: Set<string>;
  trailIntentsById: Map<string, 'destroy' | 'read' | 'write'>;
}

const createMutableProjectContext = (): MutableProjectContext => ({
  contourReferencesByName: new Map<string, Set<string>>(),
  crossTargetTrailIds: new Set<string>(),
  crudCoverageByEntity: new Map<string, Set<string>>(),
  crudTableIds: new Set<string>(),
  detourTargetTrailIds: new Set<string>(),
  knownContourIds: new Set<string>(),
  knownResourceIds: new Set<string>(),
  knownSignalIds: new Set<string>(),
  knownTrailIds: new Set<string>(),
  onTargetSignalIds: new Set<string>(),
  reconcileTableIds: new Set<string>(),
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
  ...(context.crudTableIds.size > 0
    ? { crudTableIds: context.crudTableIds }
    : {}),
  ...(context.crudCoverageByEntity.size > 0
    ? {
        crudCoverageByEntity: new Map(
          [...context.crudCoverageByEntity.entries()].map(
            ([entityId, operations]) => [
              entityId,
              new Set(operations) as ReadonlySet<string>,
            ]
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
  ...(context.onTargetSignalIds.size > 0
    ? { onTargetSignalIds: context.onTargetSignalIds }
    : {}),
  ...(context.reconcileTableIds.size > 0
    ? { reconcileTableIds: context.reconcileTableIds }
    : {}),
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

/**
 * Detours no longer reference trail IDs — they match on error classes.
 * This collector is dormant until the unreachable-detour warden rule ships
 * (see TRL-273 and ADR-0033). Kept as a stub for parity with
 * `collectTopoDetourTargetTrailIds`.
 */
const collectDetourTargetTrailIds = (
  _sourceCode: string,
  _filePath: string,
  _detourTargetTrailIds: Set<string>
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- dormant until TRL-273
): void => {};

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

const collectCrudTableIds = (
  sourceCode: string,
  filePath: string,
  crudTableIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const id of collectCrudTableIdsFromAst(ast)) {
    crudTableIds.add(id);
  }
};

const collectOnTargetSignalIds = (
  sourceCode: string,
  filePath: string,
  onTargetSignalIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const id of collectOnTargetSignalIdsFromAst(ast, sourceCode)) {
    onTargetSignalIds.add(id);
  }
};

const collectCrudCoverageByEntity = (
  sourceCode: string,
  filePath: string,
  coverageByEntity: Map<string, Set<string>>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const [entityId, operations] of collectFileCrudCoverage(
    ast,
    sourceCode
  )) {
    const bucket = coverageByEntity.get(entityId) ?? new Set<string>();
    for (const operation of operations) {
      bucket.add(operation);
    }
    coverageByEntity.set(entityId, bucket);
  }
};

const collectReconcileTableIds = (
  sourceCode: string,
  filePath: string,
  reconcileTableIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const id of collectReconcileTableIdsFromAst(ast)) {
    reconcileTableIds.add(id);
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

/**
 * Detours no longer reference trail IDs — they match on error classes.
 * Kept as a stub so downstream context population still compiles.
 */
const collectTopoDetourTargetTrailIds = (_appTopo: Topo): ReadonlySet<string> =>
  new Set();

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

const collectFileKnownIds = (
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
};

const collectFileTrailRelationships = (
  sourceFile: SourceFile,
  context: MutableProjectContext
): void => {
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

const collectFileSupplementalProjectContext = (
  sourceFile: SourceFile,
  context: MutableProjectContext
): void => {
  collectCrudTableIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.crudTableIds
  );
  collectOnTargetSignalIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.onTargetSignalIds
  );
  collectReconcileTableIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.reconcileTableIds
  );
  collectCrudCoverageByEntity(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.crudCoverageByEntity
  );
};

const collectFileProjectContext = (
  sourceFile: SourceFile,
  context: MutableProjectContext
): void => {
  collectFileKnownIds(sourceFile, context);
  collectFileTrailRelationships(sourceFile, context);
  collectFileSupplementalProjectContext(sourceFile, context);
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

const buildProjectContext = (
  sourceFiles: readonly SourceFile[],
  appTopo?: Topo | undefined
): ProjectContext => {
  const context = createMutableProjectContext();

  if (appTopo) {
    collectTopoTrailContext(appTopo, context);
    for (const sourceFile of sourceFiles) {
      collectFileSupplementalProjectContext(sourceFile, context);
    }
  } else {
    for (const sourceFile of sourceFiles) {
      collectFileProjectContext(sourceFile, context);
    }
  }

  for (const sourceFile of sourceFiles) {
    collectFileContourReferences(sourceFile, context);
  }

  return toProjectContext(context);
};

const isProjectAwareRule = (rule: WardenRule): rule is ProjectAwareWardenRule =>
  'checkWithContext' in rule;

const topoRuleFailureDiagnostic = (
  rule: TopoAwareWardenRule,
  error: unknown
): WardenDiagnostic => {
  const cause = error instanceof Error ? error : new Error(String(error));
  return {
    filePath: '<topo>',
    line: 1,
    message: `Topo-aware rule "${rule.name}" threw: ${cause.message}`,
    rule: rule.name,
    severity: 'error',
  };
};

/**
 * Run all registered topo-aware rules against the resolved topo.
 *
 * Topo-aware rules fire exactly once per run (not per file) because they
 * inspect the compiled trail graph, not source text.
 */
const lintTopo = async (
  appTopo: Topo,
  extraTopoRules: readonly TopoAwareWardenRule[]
): Promise<readonly WardenDiagnostic[]> => {
  const diagnostics: WardenDiagnostic[] = [];
  const rules: readonly TopoAwareWardenRule[] = [
    ...wardenTopoRules.values(),
    ...extraTopoRules,
  ];
  for (const rule of rules) {
    try {
      diagnostics.push(...(await rule.checkTopo(appTopo)));
    } catch (error) {
      diagnostics.push(topoRuleFailureDiagnostic(rule, error));
    }
  }
  return diagnostics;
};

const lintSourceFiles = (
  sourceFiles: readonly SourceFile[],
  context: ProjectContext
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  for (const sourceFile of sourceFiles) {
    for (const rule of wardenRules.values()) {
      if (isProjectAwareRule(rule)) {
        diagnostics.push(
          ...rule.checkWithContext(
            sourceFile.sourceCode,
            sourceFile.filePath,
            context
          )
        );
        continue;
      }
      diagnostics.push(
        ...rule.check(sourceFile.sourceCode, sourceFile.filePath)
      );
    }
  }
  return diagnostics;
};

/**
 * Lint all files against all warden rules.
 */
const lintFiles = async (
  rootDir: string,
  appTopo?: Topo | undefined,
  extraTopoRules: readonly TopoAwareWardenRule[] = []
): Promise<WardenDiagnostic[]> => {
  const sourceFiles = await loadSourceFiles(rootDir);
  const context = buildProjectContext(sourceFiles, appTopo);
  const allDiagnostics: WardenDiagnostic[] = [
    ...lintSourceFiles(sourceFiles, context),
  ];

  if (appTopo) {
    allDiagnostics.push(...(await lintTopo(appTopo, extraTopoRules)));
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
    : await lintFiles(rootDir, options.topo, options.extraTopoRules ?? []);
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
