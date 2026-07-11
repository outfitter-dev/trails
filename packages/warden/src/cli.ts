/**
 * Warden CLI command runner.
 *
 * Scans TypeScript files, runs all warden rules, optionally checks drift,
 * and returns a structured report.
 */

import { isAbsolute, relative, resolve } from 'node:path';

import { resolveTrailsProjectRoot } from '@ontrails/config';
import {
  getEntityReferences,
  matchesAnyPathGlob,
  resolveSurfaceOverlayBindings,
  surfaceBindingsFromLockOverlays,
} from '@ontrails/core';
import type { SurfaceBindings, Topo } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topography';
import type {
  TopoGraph,
  TopoGraphOverlayRegistration,
} from '@ontrails/topography';

import type {
  EffectiveWardenConfig,
  WardenConfigInput,
  WardenConfigLayer,
  WardenDepth,
  WardenFailOn,
  WardenFormat,
  WardenScope,
  WardenLockMode,
} from './config.js';
import { runWardenAdapterChecks } from './adapter-check.js';
import { resolveWardenConfig } from './config.js';
import { isDraftMarkedFile } from './draft.js';
import { applySafeFixesToSource, hasSafeFixEdits } from './fix.js';
import type { DriftResult } from './drift.js';
import { checkDrift, staleDriftMessage } from './drift.js';
import { loadProjectWardenRules } from './project-rules.js';
import type { ProjectWardenRules } from './project-rules.js';
import {
  collectProjectDocumentationImportResolutions,
  collectProjectExportedSymbolDefinitions,
  collectProjectImportResolutions,
  collectPublicWorkspaces,
} from './project-context.js';
import {
  collectComposeTargetTrailIds,
  collectTrailIntentsById,
} from './rules/source/composition.js';
import {
  collectEntityDefinitionIds,
  collectEntityReferenceTargetsByName,
} from './rules/source/entities.js';
import { collectResourceDefinitionIds } from './rules/source/resources.js';
import {
  collectOnTargetSignalIds as collectOnTargetSignalIdsFromAst,
  collectSignalDefinitionIds,
} from './rules/source/signals.js';
import {
  collectCrudTableIds as collectCrudTableIdsFromAst,
  collectReconcileTableIds as collectReconcileTableIdsFromAst,
} from './rules/source/stores.js';
import { findTrailDefinitions, parse } from '@ontrails/source';
import { collectFileCrudCoverage } from './rules/incomplete-crud.js';
import { wardenRules, wardenTopoRules } from './rules/index.js';
import { getWardenRuleMetadata } from './rules/metadata.js';
import {
  isWardenDevPermitTestScanTarget,
  isWardenSourceScanTarget,
} from './rules/scan.js';
import type {
  AuthoredMcpSurfaceBindingSet,
  ProjectAwareWardenRule,
  ProjectContext,
  TopoAwareWardenRule,
  WardenDiagnostic,
  WardenExportedSymbolDefinition,
  WardenGuidanceLink,
  WardenRule,
  WardenRuleTier,
} from './rules/types.js';
import type { WardenImportResolution } from './resolve.js';

/**
 * Resolved topo input for Warden runs that govern multiple apps.
 */
export interface WardenTopoTarget {
  /** Optional precomputed topo graph, including graph-only audit annotations. */
  readonly graph?: TopoGraph | undefined;
  /** Stable app/topo label used to tag topo-aware diagnostics. */
  readonly name?: string | undefined;
  /**
   * App-module overlay registrations collected through the shared
   * `resolveTrailsOverlays` channel, so fresh drift and topo-aware rule
   * derivations carry the same overlays the committed lock embeds.
   */
  readonly overlays?: readonly TopoGraphOverlayRegistration[] | undefined;
  /** Resolved topo module to inspect. */
  readonly topo: Topo;
}

/**
 * Options for the shared Warden runner.
 */
export interface WardenRunOptions {
  /** Root directory to scan for TypeScript files. Defaults to cwd. */
  readonly rootDir?: string | undefined;
  /** Warden config section from `trails.config.ts`, if already loaded. */
  readonly config?: WardenConfigInput | undefined;
  /** CLI/config-layer app names carried through shared resolution. */
  readonly apps?: readonly string[] | undefined;
  /** Include shared adapter authoring checks as Warden diagnostics. */
  readonly adapterCheck?: boolean | undefined;
  /** Cumulative analysis depth for the final M1 surfaces. */
  readonly depth?: WardenDepth | undefined;
  /** Draft-state handling mode for final M1 surfaces. */
  readonly drafts?: EffectiveWardenConfig['drafts'] | undefined;
  /** Failure threshold used to compute `report.passed`. */
  readonly failOn?: WardenFailOn | undefined;
  /**
   * Apply safe source fixes among the run's diagnostics, writing changed files.
   *
   * Only `safety: 'safe'` fixes with concrete edits are applied; review-required,
   * edit-less, and topo diagnostics stay reported but unapplied.
   */
  readonly fix?: boolean | undefined;
  /** Output format requested by the caller. */
  readonly format?: WardenFormat | undefined;
  /** Root-relative source paths that Warden should not govern. */
  readonly scope?: WardenScope | undefined;
  /** Lockfile mode requested by the caller. */
  readonly lock?: WardenLockMode | undefined;
  /** Suppress lockfile mutation for CI/pre-push callers. */
  readonly noLockMutation?: boolean | undefined;
  /** Environment layer for config resolution. Pass `process.env` at process boundaries. */
  readonly env?: Record<string, string | undefined> | undefined;
  /** Only run lint rules, skip drift detection */
  readonly lintOnly?: boolean | undefined;
  /** Only run drift detection, skip lint rules */
  readonly driftOnly?: boolean | undefined;
  /**
   * Run a single Warden tier. Defaults to all lint tiers plus drift.
   *
   * Selecting a non-drift tier skips drift detection; selecting `drift` skips
   * lint rule dispatch. `lintOnly` and `driftOnly` remain compatibility shims.
   */
  readonly tier?: WardenRuleTier | undefined;
  /**
   * Load project-local Warden rules from `.trails/rules.ts` or `.trails/rules/`.
   *
   * Enabled by default for normal runs so a Trails app can carry migration or
   * repo-local governance with the project instead of shipping it from
   * `@ontrails/warden`. Set to `false` for narrow tests or embedders that need
   * only built-in and explicitly provided rules.
   */
  readonly projectRules?: boolean | undefined;
  /**
   * App topology for drift detection. When provided, enables real topology
   * drift comparison and unlocks the topo-aware rule dispatch path.
   *
   * @remarks
   * Topo-aware rules (both built-in `wardenTopoRules` and `extraTopoRules`)
   * only fire when a `Topo` is supplied. Runs without a topo silently skip
   * topo-aware dispatch — callers that depend on a topo-aware rule firing
   * must pass `topo` explicitly.
   */
  readonly topo?: Topo | undefined;
  /**
   * Multiple resolved topos to govern in one invocation.
   *
   * Source/project rules run once; topo-aware rules run once per target.
   */
  readonly topos?: readonly WardenTopoTarget[] | undefined;
  /**
   * Extra topo-aware rules to run in addition to the built-in registry.
   *
   * Primarily a test hook — production callers should register rules via
   * `wardenTopoRules` in `rules/index.ts`. These rules are only invoked
   * when `topo` is also supplied (see `topo` remarks).
   */
  readonly extraTopoRules?: readonly TopoAwareWardenRule[] | undefined;
  /**
   * Extra source rules to run in addition to the built-in registry.
   *
   * Primarily a test hook — production callers should register durable rules
   * via `wardenRules` in `rules/index.ts`.
   */
  readonly extraSourceRules?: readonly WardenRule[] | undefined;
}

/** Backwards-compatible name for older consumers. */
export type WardenOptions = WardenRunOptions;

/**
 * Aggregate outcome of a `--fix` pass over a run's diagnostics.
 */
export interface WardenFixSummary {
  /** Diagnostics whose safe fix was applied to source. */
  readonly applied: number;
  /** Source files rewritten with patched content. */
  readonly filesChanged: number;
  /** Diagnostics carrying fix metadata left unapplied (review or edit-less). */
  readonly skipped: number;
}

export interface WardenFixApplication extends WardenFixSummary {
  /** Diagnostics removed from the final report because their safe fix applied. */
  readonly appliedDiagnostics: readonly WardenDiagnostic[];
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
  /** Effective shared config consumed by this run. */
  readonly effectiveConfig?: EffectiveWardenConfig | undefined;
  /** Resolved topo/app labels governed by this run. */
  readonly topoNames?: readonly string[] | undefined;
  /** Safe-fix application summary, present only when a `--fix` pass ran. */
  readonly fixes?: WardenFixSummary | undefined;
}

/**
 * Collect Warden scan targets under a directory, excluding generated and test
 * surfaces that should not contribute most committed-source diagnostics.
 */
const collectFilesMatching = (
  dir: string,
  pattern: string,
  dot = false
): readonly string[] => {
  const glob = new Bun.Glob(pattern);
  let matches: IterableIterator<string>;
  try {
    matches = glob.scanSync({ cwd: dir, dot, onlyFiles: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const match of matches) {
    if (isWardenSourceScanTarget(match)) {
      files.push(`${dir}/${match}`);
    }
  }
  return files;
};

const collectTsFiles = (dir: string): readonly string[] =>
  collectFilesMatching(dir, '**/*.ts');

const draftModeIncludesFile = (
  filePath: string,
  drafts: EffectiveWardenConfig['drafts']
): boolean => {
  const isDraftFile = isDraftMarkedFile(filePath);
  if (drafts === 'exclude') {
    return !isDraftFile;
  }
  if (drafts === 'only') {
    return isDraftFile;
  }
  return true;
};

const filterSourceFilesByDraftMode = (
  sourceFiles: readonly SourceFile[],
  drafts: EffectiveWardenConfig['drafts']
): readonly SourceFile[] =>
  drafts === 'include'
    ? sourceFiles
    : sourceFiles.filter((sourceFile) =>
        draftModeIncludesFile(sourceFile.filePath, drafts)
      );

const rootRelativeScopePath = (rootDir: string, filePath: string): string =>
  relative(rootDir, filePath).replaceAll('\\', '/');

const filterSourceFilesByScope = (
  sourceFiles: readonly SourceFile[],
  rootDir: string,
  scope: WardenScope
): readonly SourceFile[] => {
  if (scope.exclude.length === 0) {
    return sourceFiles;
  }

  return sourceFiles.filter(
    (sourceFile) =>
      !matchesAnyPathGlob(
        rootRelativeScopePath(rootDir, sourceFile.filePath),
        scope.exclude
      )
  );
};

const EMPTY_WARDEN_SCOPE: WardenScope = { exclude: [] };

const collectDevPermitTestFiles = (dir: string): readonly string[] => {
  const glob = new Bun.Glob('**/*.ts');
  let matches: IterableIterator<string>;
  try {
    matches = glob.scanSync({ cwd: dir, onlyFiles: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const match of matches) {
    if (isWardenDevPermitTestScanTarget(match)) {
      files.push(`${dir}/${match}`);
    }
  }
  return files;
};

const collectTextScanFiles = (dir: string): readonly string[] => [
  ...collectFilesMatching(dir, '**/*.sh', true),
  ...collectFilesMatching(dir, '**/*.bash', true),
  ...collectFilesMatching(dir, '**/*.zsh', true),
  ...collectFilesMatching(dir, '**/*.yml', true),
  ...collectFilesMatching(dir, '**/*.yaml', true),
  ...collectFilesMatching(dir, '**/package.json', true),
];

const isDocumentationScanTarget = (match: string): boolean => {
  if (match === 'README.md') {
    return true;
  }
  if (/^(?:packages|adapters|apps)\/[^/]+\/README\.md$/.test(match)) {
    return true;
  }
  return (
    match.startsWith('docs/') &&
    !match.startsWith('docs/adr/') &&
    !match.startsWith('docs/migration/') &&
    !match.startsWith('docs/releases/') &&
    match.endsWith('.md')
  );
};

const collectDocumentationFiles = (dir: string): readonly string[] => {
  const glob = new Bun.Glob('**/*.md');
  let matches: IterableIterator<string>;
  try {
    matches = glob.scanSync({ cwd: dir, onlyFiles: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const match of matches) {
    if (isWardenSourceScanTarget(match) && isDocumentationScanTarget(match)) {
      files.push(`${dir}/${match}`);
    }
  }
  return files;
};

interface SourceFile {
  readonly filePath: string;
  readonly kind: 'documentation' | 'text' | 'typescript';
  readonly sourceCode: string;
}

interface MutableProjectContext {
  authoredMcpSurfaceBindingSets:
    | readonly AuthoredMcpSurfaceBindingSet[]
    | undefined;
  entityReferencesByName: Map<string, Set<string>>;
  crudTableIds: Set<string>;
  composeTargetTrailIds: Set<string>;
  crudCoverageByEntity: Map<string, Set<string>>;
  knownEntityIds: Set<string>;
  knownResourceIds: Set<string>;
  knownSignalIds: Set<string>;
  knownTrailIds: Set<string>;
  topoTrailIds: Set<string>;
  importResolutionsByFile: Map<string, readonly WardenImportResolution[]>;
  exportedSymbolDefinitionsByName: Map<
    string,
    readonly WardenExportedSymbolDefinition[]
  >;
  documentedImportResolutionsByFile: Map<
    string,
    readonly WardenImportResolution[]
  >;
  onTargetSignalIds: Set<string>;
  publicWorkspaces: ReturnType<typeof collectPublicWorkspaces>;
  reconcileTableIds: Set<string>;
  trailIntentsById: Map<string, 'destroy' | 'read' | 'write'>;
}

const createMutableProjectContext = (): MutableProjectContext => ({
  authoredMcpSurfaceBindingSets: undefined,
  composeTargetTrailIds: new Set<string>(),
  crudCoverageByEntity: new Map<string, Set<string>>(),
  crudTableIds: new Set<string>(),
  documentedImportResolutionsByFile: new Map<
    string,
    readonly WardenImportResolution[]
  >(),
  entityReferencesByName: new Map<string, Set<string>>(),
  exportedSymbolDefinitionsByName: new Map(),
  importResolutionsByFile: new Map<string, readonly WardenImportResolution[]>(),
  knownEntityIds: new Set<string>(),
  knownResourceIds: new Set<string>(),
  knownSignalIds: new Set<string>(),
  knownTrailIds: new Set<string>(),
  onTargetSignalIds: new Set<string>(),
  publicWorkspaces: new Map(),
  reconcileTableIds: new Set<string>(),
  topoTrailIds: new Set<string>(),
  trailIntentsById: new Map<string, 'destroy' | 'read' | 'write'>(),
});

const addEntityReferenceTargets = (
  context: MutableProjectContext,
  entityName: string,
  targets: readonly string[]
): void => {
  const existing = context.entityReferencesByName.get(entityName);
  if (existing) {
    for (const target of targets) {
      existing.add(target);
    }
    return;
  }

  context.entityReferencesByName.set(entityName, new Set(targets));
};

const toProjectContext = (context: MutableProjectContext): ProjectContext => ({
  ...(context.authoredMcpSurfaceBindingSets === undefined
    ? {}
    : { authoredMcpSurfaceBindingSets: context.authoredMcpSurfaceBindingSets }),
  ...(context.entityReferencesByName.size > 0
    ? {
        entityReferencesByName: new Map(
          [...context.entityReferencesByName.entries()].map(
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
  composeTargetTrailIds: context.composeTargetTrailIds,
  knownEntityIds: context.knownEntityIds,
  knownResourceIds: context.knownResourceIds,
  knownSignalIds: context.knownSignalIds,
  knownTrailIds: context.knownTrailIds,
  ...(context.topoTrailIds.size > 0
    ? { topoTrailIds: context.topoTrailIds }
    : {}),
  ...(context.importResolutionsByFile.size > 0
    ? { importResolutionsByFile: context.importResolutionsByFile }
    : {}),
  ...(context.documentedImportResolutionsByFile.size > 0
    ? {
        documentedImportResolutionsByFile:
          context.documentedImportResolutionsByFile,
      }
    : {}),
  ...(context.exportedSymbolDefinitionsByName.size > 0
    ? {
        exportedSymbolDefinitionsByName:
          context.exportedSymbolDefinitionsByName,
      }
    : {}),
  ...(context.onTargetSignalIds.size > 0
    ? { onTargetSignalIds: context.onTargetSignalIds }
    : {}),
  ...(context.publicWorkspaces.size > 0
    ? { publicWorkspaces: context.publicWorkspaces }
    : {}),
  ...(context.reconcileTableIds.size > 0
    ? { reconcileTableIds: context.reconcileTableIds }
    : {}),
  trailIntentsById: context.trailIntentsById,
});

const collectKnownEntityIds = (
  sourceCode: string,
  filePath: string,
  knownEntityIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const id of collectEntityDefinitionIds(ast)) {
    knownEntityIds.add(id);
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

const collectComposedTrailIds = (
  sourceCode: string,
  filePath: string,
  composeTargetTrailIds: Set<string>
): void => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return;
  }
  for (const id of collectComposeTargetTrailIds(ast, sourceCode)) {
    composeTargetTrailIds.add(id);
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
        kind: 'typescript',
        sourceCode: await Bun.file(filePath).text(),
      });
    } catch {
      continue;
    }
  }

  for (const filePath of collectTextScanFiles(rootDir)) {
    try {
      sourceFiles.push({
        filePath,
        kind: 'text',
        sourceCode: await Bun.file(filePath).text(),
      });
    } catch {
      continue;
    }
  }

  for (const filePath of collectDocumentationFiles(rootDir)) {
    try {
      sourceFiles.push({
        filePath,
        kind: 'documentation',
        sourceCode: await Bun.file(filePath).text(),
      });
    } catch {
      continue;
    }
  }

  for (const filePath of collectDevPermitTestFiles(rootDir)) {
    try {
      sourceFiles.push({
        filePath,
        kind: 'text',
        sourceCode: await Bun.file(filePath).text(),
      });
    } catch {
      continue;
    }
  }

  return sourceFiles;
};

const collectTopoKnownIds = (
  appTopo: Topo,
  context: MutableProjectContext
): void => {
  for (const name of appTopo.entities.keys()) {
    context.knownEntityIds.add(name);
  }

  for (const id of appTopo.trails.keys()) {
    context.knownTrailIds.add(id);
    context.topoTrailIds.add(id);
  }

  for (const id of appTopo.resources.keys()) {
    context.knownResourceIds.add(id);
  }

  for (const id of appTopo.signals.keys()) {
    context.knownSignalIds.add(id);
  }
};

const collectTopoComposesAndIntents = (
  appTopo: Topo,
  context: MutableProjectContext
): void => {
  for (const trail of appTopo.trails.values()) {
    context.trailIntentsById.set(trail.id, trail.intent);
    for (const composedTrailId of trail.composes) {
      context.composeTargetTrailIds.add(composedTrailId);
    }
  }
};

const collectTopoEntityReferences = (
  appTopo: Topo,
  context: MutableProjectContext
): void => {
  for (const entity of appTopo.listEntities()) {
    addEntityReferenceTargets(
      context,
      entity.name,
      getEntityReferences(entity).map((reference) => reference.entity)
    );
  }
};

const collectTopoTrailContext = (
  appTopo: Topo,
  context: MutableProjectContext
): void => {
  collectTopoKnownIds(appTopo, context);
  collectTopoComposesAndIntents(appTopo, context);
  collectTopoEntityReferences(appTopo, context);
};

const collectFileKnownIds = (
  sourceFile: SourceFile,
  context: MutableProjectContext
): void => {
  collectKnownEntityIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.knownEntityIds
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
  collectComposedTrailIds(
    sourceFile.sourceCode,
    sourceFile.filePath,
    context.composeTargetTrailIds
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

const collectFileEntityReferences = (
  sourceFile: SourceFile,
  context: MutableProjectContext
): void => {
  const ast = parse(sourceFile.filePath, sourceFile.sourceCode);
  if (!ast) {
    return;
  }

  const referencesByName = collectEntityReferenceTargetsByName(
    ast,
    context.knownEntityIds
  );
  for (const [entityName, targets] of referencesByName) {
    addEntityReferenceTargets(context, entityName, targets);
  }
};

const collectFileImportResolutions = (
  rootDir: string,
  sourceFiles: readonly SourceFile[],
  context: MutableProjectContext
): void => {
  const resolutionsByFile = collectProjectImportResolutions({
    publicWorkspaces: context.publicWorkspaces,
    rootDir,
    sourceFiles,
  });
  for (const [filePath, resolutions] of resolutionsByFile) {
    context.importResolutionsByFile.set(filePath, resolutions);
  }
};

const collectFileDocumentedImportResolutions = (
  rootDir: string,
  sourceFiles: readonly SourceFile[],
  context: MutableProjectContext
): void => {
  const resolutionsByFile = collectProjectDocumentationImportResolutions({
    publicWorkspaces: context.publicWorkspaces,
    rootDir,
    sourceFiles,
  });
  for (const [filePath, resolutions] of resolutionsByFile) {
    context.documentedImportResolutionsByFile.set(filePath, resolutions);
  }
};

const collectFileExportedSymbolDefinitions = (
  rootDir: string,
  sourceFiles: readonly SourceFile[],
  context: MutableProjectContext
): void => {
  const definitionsByName = collectProjectExportedSymbolDefinitions({
    publicWorkspaces: context.publicWorkspaces,
    rootDir,
    sourceFiles,
  });
  for (const [name, definitions] of definitionsByName) {
    context.exportedSymbolDefinitionsByName.set(name, definitions);
  }
};

/**
 * Resolve per-app authored `mcp` surface bindings across the run's topo
 * targets, so project-aware source rules can compare call-site surface
 * options against the authored default of the app they belong to.
 *
 * Prefers the serialized graph overlays when a target carries a precomputed
 * graph; otherwise reads the app-module overlay registrations. Invalid
 * overlays are skipped here — `surface-overlay-coherence` reports them on
 * the topo-aware path.
 */
const collectAuthoredMcpSurfaceBindingSets = (
  topoTargets: readonly WardenTopoTarget[]
): readonly AuthoredMcpSurfaceBindingSet[] | undefined => {
  const sets: AuthoredMcpSurfaceBindingSet[] = [];
  for (const target of topoTargets) {
    let bindings: SurfaceBindings | undefined;
    try {
      const graphOverlays = target.graph?.overlays;
      bindings =
        graphOverlays === undefined
          ? resolveSurfaceOverlayBindings(target.overlays)?.mcp
          : surfaceBindingsFromLockOverlays(graphOverlays)?.mcp;
    } catch {
      continue;
    }
    if (bindings === undefined) {
      continue;
    }
    sets.push({
      appName: target.name ?? target.topo.name,
      bindings,
      trailIds: [...target.topo.trails.keys()],
    });
  }
  return sets.length > 0 ? sets : undefined;
};

const buildProjectContext = (
  sourceFiles: readonly SourceFile[],
  rootDir: string,
  appTopos: readonly Topo[] = [],
  scope: WardenScope = EMPTY_WARDEN_SCOPE,
  authoredMcpSurfaceBindingSets:
    | readonly AuthoredMcpSurfaceBindingSet[]
    | undefined = undefined
): ProjectContext => {
  const context = createMutableProjectContext();
  context.authoredMcpSurfaceBindingSets = authoredMcpSurfaceBindingSets;
  const typeScriptSourceFiles = sourceFiles.filter(
    (sourceFile) => sourceFile.kind === 'typescript'
  );
  const documentationSourceFiles = sourceFiles.filter(
    (sourceFile) => sourceFile.kind === 'documentation'
  );
  context.publicWorkspaces = collectPublicWorkspaces(rootDir, {
    exclude: scope.exclude,
  });

  if (appTopos.length > 0) {
    for (const appTopo of appTopos) {
      collectTopoTrailContext(appTopo, context);
    }
    for (const sourceFile of typeScriptSourceFiles) {
      collectFileSupplementalProjectContext(sourceFile, context);
    }
  } else {
    for (const sourceFile of typeScriptSourceFiles) {
      collectFileProjectContext(sourceFile, context);
    }
  }

  for (const sourceFile of typeScriptSourceFiles) {
    collectFileEntityReferences(sourceFile, context);
  }
  collectFileImportResolutions(rootDir, typeScriptSourceFiles, context);
  collectFileDocumentedImportResolutions(
    rootDir,
    documentationSourceFiles,
    context
  );
  collectFileExportedSymbolDefinitions(rootDir, typeScriptSourceFiles, context);

  return toProjectContext(context);
};

const isProjectAwareRule = (rule: WardenRule): rule is ProjectAwareWardenRule =>
  'checkWithContext' in rule;

const createOptionsDiagnostic = (message: string): WardenDiagnostic => ({
  filePath: '<warden-options>',
  line: 1,
  message,
  rule: 'warden-options',
  severity: 'error',
});

const emptyProjectWardenRules = (): ProjectWardenRules => ({
  diagnostics: [],
  sourceRules: [],
  topoRules: [],
});

const loadProjectRulesForRun = async (
  rootDir: string,
  options: WardenRunOptions,
  runLint: boolean
): Promise<ProjectWardenRules> => {
  if (!runLint || options.projectRules === false) {
    return emptyProjectWardenRules();
  }
  return loadProjectWardenRules(rootDir);
};

interface WardenRuleSelector {
  readonly depth?: WardenDepth | undefined;
  readonly tier?: WardenRuleTier | undefined;
}

const depthIncludesTier = (
  depth: WardenDepth,
  tier: WardenRuleTier
): boolean => {
  switch (depth) {
    case 'source': {
      return tier === 'source-static';
    }
    case 'project': {
      return tier === 'source-static' || tier === 'project-static';
    }
    case 'topo': {
      return (
        tier === 'source-static' ||
        tier === 'project-static' ||
        tier === 'topo-aware'
      );
    }
    case 'all': {
      return true;
    }
    default: {
      return false;
    }
  }
};

const ruleMatchesTier = (
  metadata: ReturnType<typeof getWardenRuleMetadata>,
  tier: WardenRuleTier | undefined
): boolean => {
  if (!tier) {
    return true;
  }

  if (!metadata) {
    return false;
  }

  return tier === 'advisory'
    ? metadata.scope === 'advisory'
    : metadata.tier === tier;
};

const ruleMatchesDepth = (
  metadata: ReturnType<typeof getWardenRuleMetadata>,
  depth: WardenDepth | undefined
): boolean => {
  if (!depth) {
    return true;
  }

  if (!metadata) {
    return false;
  }

  if (metadata.scope === 'advisory') {
    return depth === 'all';
  }

  return depthIncludesTier(depth, metadata.tier);
};

const isSelectedRule = (
  rule: WardenRule | TopoAwareWardenRule,
  selector: WardenRuleSelector
): boolean => {
  const metadata = getWardenRuleMetadata(rule);
  return selector.tier
    ? ruleMatchesTier(metadata, selector.tier)
    : ruleMatchesDepth(metadata, selector.depth);
};

const isSelectedTopoRule = (
  rule: TopoAwareWardenRule,
  selector: WardenRuleSelector
): boolean => {
  const metadata = getWardenRuleMetadata(rule);
  if (selector.tier) {
    return metadata
      ? ruleMatchesTier(metadata, selector.tier)
      : selector.tier === 'topo-aware';
  }

  return metadata ? ruleMatchesDepth(metadata, selector.depth) : true;
};

const withDiagnosticGuidance = (
  diagnostic: WardenDiagnostic
): WardenDiagnostic => {
  if (diagnostic.guidance !== undefined) {
    return diagnostic;
  }

  const guidance = getWardenRuleMetadata(diagnostic.rule)?.guidance;
  return guidance === undefined ? diagnostic : { ...diagnostic, guidance };
};

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
  graph: TopoGraph | undefined,
  overlays: readonly TopoGraphOverlayRegistration[] | undefined,
  extraTopoRules: readonly TopoAwareWardenRule[],
  selector: WardenRuleSelector
): Promise<readonly WardenDiagnostic[]> => {
  const diagnostics: WardenDiagnostic[] = [];
  const rules: readonly TopoAwareWardenRule[] = [
    ...wardenTopoRules.values(),
    ...extraTopoRules,
  ].filter((rule) => isSelectedTopoRule(rule, selector));
  let contextGraph: TopoGraph;
  try {
    contextGraph = graph ?? deriveTopoGraph(appTopo, { overlays });
  } catch (error) {
    for (const rule of rules) {
      diagnostics.push(topoRuleFailureDiagnostic(rule, error));
    }
    return diagnostics;
  }

  for (const rule of rules) {
    try {
      diagnostics.push(
        ...(await rule.checkTopo(appTopo, { graph: contextGraph }))
      );
    } catch (error) {
      diagnostics.push(topoRuleFailureDiagnostic(rule, error));
    }
  }
  return diagnostics;
};

const lintSourceFiles = (
  sourceFiles: readonly SourceFile[],
  context: ProjectContext,
  extraSourceRules: readonly WardenRule[],
  selector: WardenRuleSelector
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const rules = [...wardenRules.values(), ...extraSourceRules];
  for (const sourceFile of sourceFiles) {
    for (const rule of rules) {
      if (
        sourceFile.kind === 'text' &&
        rule.name !== 'no-dev-permit-in-source' &&
        rule.name !== 'public-internal-deep-imports'
      ) {
        continue;
      }

      if (
        sourceFile.kind === 'documentation' &&
        rule.name !== 'public-internal-deep-imports'
      ) {
        continue;
      }

      if (!isSelectedRule(rule, selector)) {
        continue;
      }

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

const tagTopoDiagnostic = (
  diagnostic: WardenDiagnostic,
  topoName: string | undefined
): WardenDiagnostic =>
  topoName === undefined ? diagnostic : { ...diagnostic, topoName };

const lintTopoTargets = async (
  topoTargets: readonly WardenTopoTarget[],
  extraTopoRules: readonly TopoAwareWardenRule[],
  selector: WardenRuleSelector,
  tagDiagnostics: boolean
): Promise<readonly WardenDiagnostic[]> => {
  const diagnostics: WardenDiagnostic[] = [];

  for (const target of topoTargets) {
    const topoDiagnostics = await lintTopo(
      target.topo,
      target.graph,
      target.overlays,
      extraTopoRules,
      selector
    );
    const topoName = target.name ?? target.topo.name;
    diagnostics.push(
      ...(tagDiagnostics
        ? topoDiagnostics.map((diagnostic) =>
            tagTopoDiagnostic(diagnostic, topoName)
          )
        : topoDiagnostics)
    );
  }

  return diagnostics;
};

const selectorIncludesTopoRules = (selector: WardenRuleSelector): boolean => {
  if (selector.tier) {
    return selector.tier === 'advisory';
  }

  return !selector.depth || depthIncludesTier(selector.depth, 'topo-aware');
};

/**
 * Lint all files against all warden rules.
 */
interface WardenLintResult {
  readonly diagnostics: readonly WardenDiagnostic[];
  readonly sourceFiles: readonly SourceFile[];
}

const lintFiles = async (
  rootDir: string,
  drafts: EffectiveWardenConfig['drafts'],
  scope: EffectiveWardenConfig['scope'],
  topoTargets: readonly WardenTopoTarget[],
  extraTopoRules: readonly TopoAwareWardenRule[],
  extraSourceRules: readonly WardenRule[],
  selector: WardenRuleSelector
): Promise<WardenLintResult> => {
  if (selector.tier === 'topo-aware') {
    return {
      diagnostics: [
        ...(await lintTopoTargets(topoTargets, extraTopoRules, selector, true)),
      ],
      sourceFiles: [],
    };
  }

  const sourceFiles = filterSourceFilesByScope(
    filterSourceFilesByDraftMode(await loadSourceFiles(rootDir), drafts),
    rootDir,
    scope
  );
  const context = buildProjectContext(
    sourceFiles,
    rootDir,
    topoTargets.map((target) => target.topo),
    scope,
    collectAuthoredMcpSurfaceBindingSets(topoTargets)
  );
  const allDiagnostics: WardenDiagnostic[] = [
    ...lintSourceFiles(sourceFiles, context, extraSourceRules, selector),
  ];

  if (
    topoTargets.length > 0 &&
    (selector.tier === undefined || selector.tier === 'advisory') &&
    selectorIncludesTopoRules(selector)
  ) {
    allDiagnostics.push(
      ...(await lintTopoTargets(
        topoTargets,
        extraTopoRules,
        selector,
        topoTargets.length > 1
      ))
    );
  }

  return { diagnostics: allDiagnostics, sourceFiles };
};

const topoTargetsFromOptions = (
  options: WardenRunOptions
): readonly WardenTopoTarget[] => {
  if (options.topos !== undefined && options.topos.length > 0) {
    return options.topos;
  }

  return options.topo ? [{ name: options.topo.name, topo: options.topo }] : [];
};

const aggregateDriftHash = (
  topoTargets: readonly WardenTopoTarget[],
  driftResults: readonly DriftResult[]
): string => {
  const currentHashes = new Set(
    driftResults.map((result) => result.currentHash)
  );
  const [onlyHash] = currentHashes;
  if (currentHashes.size === 1 && onlyHash !== undefined) {
    return onlyHash;
  }

  const payload = driftResults
    .map((result, index) => {
      const target = topoTargets[index];
      return {
        currentHash: result.currentHash,
        topoName: target?.name ?? target?.topo.name ?? `topo-${String(index)}`,
      };
    })
    .toSorted((left, right) => left.topoName.localeCompare(right.topoName));
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(JSON.stringify(payload));
  return hasher.digest('hex');
};

const describeTopoDriftHash = (
  topoTargets: readonly WardenTopoTarget[],
  driftResults: readonly DriftResult[]
): string =>
  driftResults
    .map((result, index) => {
      const target = topoTargets[index];
      const topoName =
        target?.name ?? target?.topo.name ?? `topo-${String(index)}`;
      return `${topoName}=${result.committedHash ?? '<none>'}`;
    })
    .join(', ');

const checkDriftForTopoTargets = async (
  rootDir: string,
  topoTargets: readonly WardenTopoTarget[]
): Promise<DriftResult> => {
  if (topoTargets.length <= 1) {
    const [target] = topoTargets;
    return checkDrift(
      rootDir,
      target?.topo,
      target === undefined ? undefined : { overlays: target.overlays }
    );
  }

  const driftResults = await Promise.all(
    topoTargets.map((target) =>
      checkDrift(rootDir, target.topo, { overlays: target.overlays })
    )
  );
  const committedHashes = new Set(
    driftResults.map((result) => result.committedHash)
  );
  if (committedHashes.size > 1) {
    return {
      blockedReason: `multi-topo drift expected one committed trails.lock hash but found conflicting hashes: ${describeTopoDriftHash(topoTargets, driftResults)}`,
      committedHash: null,
      currentHash: 'blocked',
      stale: true,
    };
  }
  const committedHash = driftResults[0]?.committedHash ?? null;
  const blockedReasons = driftResults.flatMap((result, index) => {
    if (result.blockedReason === undefined) {
      return [];
    }
    const target = topoTargets[index];
    const topoName =
      target?.name ?? target?.topo.name ?? `topo-${String(index)}`;
    return [`${topoName}: ${result.blockedReason}`];
  });

  if (blockedReasons.length > 0) {
    return {
      blockedReason: blockedReasons.join('; '),
      committedHash,
      currentHash: 'blocked',
      stale: true,
    };
  }

  const currentHash = aggregateDriftHash(topoTargets, driftResults);
  const driftedOverlayNamespaces = [
    ...new Set(
      driftResults.flatMap((result) => result.driftedOverlayNamespaces ?? [])
    ),
  ].toSorted();
  return {
    committedHash,
    currentHash,
    ...(driftedOverlayNamespaces.length === 0
      ? {}
      : { driftedOverlayNamespaces }),
    stale: committedHash !== null && committedHash !== currentHash,
  };
};

const shouldRunLint = (options: WardenRunOptions): boolean =>
  options.tier ? options.tier !== 'drift' : !options.driftOnly;

const adapterDiagnosticsForRun = (
  rootDir: string,
  options: WardenRunOptions
): readonly WardenDiagnostic[] =>
  options.adapterCheck ? runWardenAdapterChecks(rootDir) : [];

const shouldRunDrift = (
  options: WardenRunOptions,
  effectiveConfig: EffectiveWardenConfig
): boolean => {
  if (effectiveConfig.lock === 'skip') {
    return false;
  }

  if (options.tier) {
    return options.tier === 'drift';
  }

  if (options.lintOnly) {
    return false;
  }

  return options.driftOnly || effectiveConfig.depth === 'all';
};

const reportPassed = ({
  drift,
  errorCount,
  failOn,
  warnCount,
}: {
  readonly drift: DriftResult | null;
  readonly errorCount: number;
  readonly failOn: WardenFailOn;
  readonly warnCount: number;
}): boolean =>
  errorCount === 0 &&
  (failOn === 'error' || warnCount === 0) &&
  !(drift?.stale ?? false) &&
  drift?.blockedReason === undefined;

const buildCliConfigLayer = (options: WardenRunOptions): WardenConfigLayer => ({
  ...(options.apps ? { apps: [...options.apps] } : {}),
  ...(options.depth ? { depth: options.depth } : {}),
  ...(options.drafts ? { drafts: options.drafts } : {}),
  ...(options.failOn ? { failOn: options.failOn } : {}),
  ...(options.format ? { format: options.format } : {}),
  ...(options.scope ? { scope: options.scope } : {}),
  ...(options.lock ? { lock: options.lock } : {}),
  ...(options.noLockMutation === undefined
    ? {}
    : { noLockMutation: options.noLockMutation }),
});

const fixSummary = (application: WardenFixApplication): WardenFixSummary => ({
  applied: application.applied,
  filesChanged: application.filesChanged,
  skipped: application.skipped,
});

const filterAppliedFixDiagnostics = (
  diagnostics: readonly WardenDiagnostic[],
  appliedDiagnostics: readonly WardenDiagnostic[]
): readonly WardenDiagnostic[] => {
  if (appliedDiagnostics.length === 0) {
    return diagnostics;
  }
  const applied = new Set(appliedDiagnostics);
  return diagnostics.filter((diagnostic) => !applied.has(diagnostic));
};

const blockedDriftAfterSourceFixes = (): DriftResult => ({
  blockedReason:
    'Source fixes were applied; rerun Warden to refresh drift evidence.',
  committedHash: null,
  currentHash: 'blocked',
  stale: true,
});

/**
 * Apply every safe source fix among a run's diagnostics, writing patched files.
 *
 * Diagnostics with a safe, edit-bearing fix are grouped by file; each file is
 * re-read so the rule's recorded offsets stay valid, patched via
 * {@link applySafeFixesToSource}, and written back only when its source
 * actually changed. Diagnostics that carry fix metadata but are not safe with
 * edits (review-required or edit-less) are counted as skipped and left reported
 * for a human or downstream regrade to resolve. Diagnostics without fix
 * metadata — including topo diagnostics, which carry no source span — are
 * neither applied nor counted in `skipped`.
 */
export const applySafeFixesToFiles = async (
  diagnostics: readonly WardenDiagnostic[],
  options: {
    readonly allowedFilePaths?: ReadonlySet<string> | readonly string[];
    readonly rootDir: string;
  }
): Promise<WardenFixApplication> => {
  const rootDir = resolve(options.rootDir);
  const allowedFilePaths =
    options.allowedFilePaths === undefined
      ? undefined
      : new Set(
          [...options.allowedFilePaths].map((filePath) => resolve(filePath))
        );
  const fixableByFile = new Map<string, WardenDiagnostic[]>();
  let skipped = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.fix === undefined) {
      continue;
    }
    if (hasSafeFixEdits(diagnostic)) {
      const filePath = resolve(diagnostic.filePath);
      const rootRelativePath = relative(rootDir, filePath);
      const insideRoot =
        rootRelativePath.length === 0 ||
        (!rootRelativePath.startsWith('..') && !isAbsolute(rootRelativePath));
      if (
        !insideRoot ||
        (allowedFilePaths !== undefined && !allowedFilePaths.has(filePath))
      ) {
        skipped += 1;
        continue;
      }
      const bucket = fixableByFile.get(filePath) ?? [];
      bucket.push(diagnostic);
      fixableByFile.set(filePath, bucket);
    } else {
      skipped += 1;
    }
  }

  let applied = 0;
  const appliedDiagnostics: WardenDiagnostic[] = [];
  let filesChanged = 0;
  for (const [filePath, group] of fixableByFile) {
    const source = await Bun.file(filePath).text();
    const result = applySafeFixesToSource(source, group);
    applied += result.applied.length;
    appliedDiagnostics.push(...result.applied);
    if (result.changed) {
      await Bun.write(filePath, result.patched);
      filesChanged += 1;
    }
  }

  return { applied, appliedDiagnostics, filesChanged, skipped };
};

/**
 * Run all warden checks and return a structured report.
 */
export const runWarden = async (
  options: WardenRunOptions = {}
): Promise<WardenReport> => {
  const { rootDir } = resolveTrailsProjectRoot({
    explicitRootDir: options.rootDir,
    startDir: process.cwd(),
  });
  const { diagnostics: configDiagnostics, effectiveConfig } =
    resolveWardenConfig({
      cli: buildCliConfigLayer(options),
      config: options.config,
      env: options.env,
    });
  const optionDiagnostics =
    !options.tier && options.lintOnly && options.driftOnly
      ? [
          createOptionsDiagnostic(
            'lintOnly and driftOnly cannot both be true. Use tier to select a single Warden mode.'
          ),
        ]
      : [];
  const topoTargets = topoTargetsFromOptions(options);
  const selector = {
    depth: options.tier ? undefined : effectiveConfig.depth,
    tier: options.tier,
  } satisfies WardenRuleSelector;
  const runLint = shouldRunLint(options);
  const runDrift = shouldRunDrift(options, effectiveConfig);
  const projectRules = await loadProjectRulesForRun(rootDir, options, runLint);
  const lintResult = runLint
    ? await lintFiles(
        rootDir,
        effectiveConfig.drafts,
        effectiveConfig.scope,
        topoTargets,
        [...projectRules.topoRules, ...(options.extraTopoRules ?? [])],
        [...projectRules.sourceRules, ...(options.extraSourceRules ?? [])],
        selector
      )
    : { diagnostics: [], sourceFiles: [] };
  const adapterDiagnostics = adapterDiagnosticsForRun(rootDir, options);

  const rawDiagnostics = [
    ...configDiagnostics,
    ...projectRules.diagnostics,
    ...optionDiagnostics,
    ...lintResult.diagnostics,
    ...adapterDiagnostics,
  ];
  const allDiagnostics = rawDiagnostics.map(withDiagnosticGuidance);
  const fixApplication = options.fix
    ? await applySafeFixesToFiles(allDiagnostics, {
        allowedFilePaths: lintResult.sourceFiles.map(
          (sourceFile) => sourceFile.filePath
        ),
        rootDir,
      })
    : undefined;
  const reportDiagnostics = filterAppliedFixDiagnostics(
    allDiagnostics,
    fixApplication?.appliedDiagnostics ?? []
  );
  let drift: DriftResult | null = null;
  if (runDrift) {
    drift =
      fixApplication !== undefined && fixApplication.filesChanged > 0
        ? blockedDriftAfterSourceFixes()
        : await checkDriftForTopoTargets(rootDir, topoTargets);
  }

  const errorCount = reportDiagnostics.filter(
    (d) => d.severity === 'error'
  ).length;
  const warnCount = reportDiagnostics.filter(
    (d) => d.severity === 'warn'
  ).length;
  const topoNames =
    topoTargets.length > 0
      ? topoTargets.map((target) => target.name ?? target.topo.name)
      : undefined;

  return {
    diagnostics: reportDiagnostics,
    drift,
    effectiveConfig,
    errorCount,
    ...(fixApplication === undefined
      ? {}
      : { fixes: fixSummary(fixApplication) }),
    passed: reportPassed({
      drift,
      errorCount,
      failOn: effectiveConfig.failOn,
      warnCount,
    }),
    ...(topoNames === undefined ? {} : { topoNames }),
    warnCount,
  };
};

const formatPlainGuidanceLink = (link: WardenGuidanceLink): string => {
  const target = link.path ?? link.url;
  if (target === undefined || target === link.label) {
    return link.label;
  }
  return `${link.label} (${target})`;
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
    if (d.guidance !== undefined) {
      lines.push(`    Next: ${d.guidance.summary}`);
      for (const [index, step] of (d.guidance.steps ?? []).entries()) {
        lines.push(`    ${String(index + 1)}. ${step}`);
      }
      if (d.guidance.commands !== undefined) {
        lines.push(
          `    Commands: ${d.guidance.commands.map((cmd) => `\`${cmd}\``).join(', ')}`
        );
      }
      if (d.guidance.docs !== undefined) {
        lines.push(
          `    Docs: ${d.guidance.docs.map(formatPlainGuidanceLink).join(', ')}`
        );
      }
      if (d.guidance.relatedRules !== undefined) {
        lines.push(`    Related: ${d.guidance.relatedRules.join(', ')}`);
      }
    }
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
    ? `Drift: ${staleDriftMessage(drift)}`
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
  if (report.warnCount > 0 && report.effectiveConfig?.failOn === 'warning') {
    parts.push(`${report.warnCount} warnings`);
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
