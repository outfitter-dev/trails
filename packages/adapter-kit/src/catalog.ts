/**
 * Read-only adapter target catalog derivation.
 *
 * Owner packages author the few adapter facts package metadata cannot derive.
 * Tooling consumes those facts; runtime adapters must never import this
 * internal tooling package.
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { listWorkspacePackages } from '@ontrails/core';

import {
  adapterSourceExportKind,
  adapterSourceExportKindHasType,
  adapterSourceExportKindHasValue,
} from './source.js';

export const adapterTargetPlacements = ['extracted', 'subpath'] as const;

export type AdapterTargetPlacementValue =
  (typeof adapterTargetPlacements)[number];

export type AdapterTargetPlacement = AdapterTargetPlacementValue;

export interface AdapterTargetConformanceManifest {
  readonly adapterType: string;
  readonly casesFactory: string;
  readonly runner: string;
}

export interface AdapterTargetManifestEntry {
  readonly conformance?: AdapterTargetConformanceManifest | undefined;
  readonly placements: readonly AdapterTargetPlacement[];
  readonly supportImport?: string | undefined;
  readonly testingImport?: string | undefined;
}

export interface AdapterTargetCatalogEntry extends AdapterTargetManifestEntry {
  readonly key: string;
  readonly ownerPackage: string;
  readonly packageJsonPath: string;
  readonly packageRoot: string;
  readonly supportExportTarget?: string | undefined;
  readonly target: string;
  readonly testingExportTarget?: string | undefined;
}

export type AdapterTargetCatalogDiagnosticCode =
  | 'duplicate-adapter-target'
  | 'invalid-adapter-target'
  | 'invalid-adapter-targets'
  | 'invalid-conformance'
  | 'invalid-import'
  | 'invalid-placement';

export interface AdapterTargetCatalogDiagnostic {
  readonly code: AdapterTargetCatalogDiagnosticCode;
  readonly message: string;
  readonly packageJsonPath: string;
  readonly packageName?: string | undefined;
  readonly target?: string | undefined;
}

export interface AdapterTargetCatalog {
  readonly diagnostics: readonly AdapterTargetCatalogDiagnostic[];
  readonly targets: readonly AdapterTargetCatalogEntry[];
}

export interface AdapterTargetPackageManifest {
  readonly exports?: unknown;
  readonly name?: unknown;
  readonly trails?: unknown;
}

type NamedAdapterTargetPackageManifest = AdapterTargetPackageManifest & {
  readonly name: string;
};

export interface AdapterTargetParseContext {
  readonly blockedExportSpecifiers: readonly string[];
  readonly exportTargets: Readonly<Record<string, string>>;
  readonly packageJsonPath: string;
  readonly packageName: string;
  readonly packageRoot: string;
}

interface ParsedCatalogTarget {
  readonly diagnostics: readonly AdapterTargetCatalogDiagnostic[];
  readonly targetEntry?: AdapterTargetCatalogEntry | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const targetIdPattern = /^[a-z][a-z0-9-]*$/u;
const exportIdentifierPattern = /^[A-Za-z_$][\w$]*$/u;

const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const pathIsFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const exportConditions = new Set([
  'bun',
  'node',
  'node-addons',
  'module-sync',
  'import',
  'default',
]);

type ResolvedExportTarget =
  | { readonly kind: 'target'; readonly target: string }
  | { readonly kind: 'blocked' };

const packageExportSegmentIsSafe = (segment: string): boolean => {
  if (segment.length === 0) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }
  return (
    decoded !== '.' &&
    decoded !== '..' &&
    decoded.toLowerCase() !== 'node_modules' &&
    !decoded.includes('/') &&
    !decoded.includes('\\')
  );
};

const exportTargetIsSafe = (target: string): boolean =>
  target.startsWith('./') &&
  !target.includes('\\') &&
  target.slice(2).split('/').every(packageExportSegmentIsSafe);

const resolveExportTarget = (
  target: unknown,
  depth = 0
): ResolvedExportTarget | undefined => {
  if (typeof target === 'string') {
    return { kind: 'target', target };
  }
  if (target === null) {
    return { kind: 'blocked' };
  }
  if (Array.isArray(target)) {
    if (depth > 8) {
      return undefined;
    }
    for (const targetEntry of target) {
      const resolvedTarget = resolveExportTarget(targetEntry, depth + 1);
      if (
        resolvedTarget?.kind === 'target' &&
        exportTargetIsSafe(resolvedTarget.target)
      ) {
        return resolvedTarget;
      }
    }
    return { kind: 'blocked' };
  }
  if (!isRecord(target) || depth > 8) {
    return undefined;
  }

  for (const [condition, conditionTarget] of Object.entries(target)) {
    if (!exportConditions.has(condition)) {
      continue;
    }
    const resolvedTarget = resolveExportTarget(conditionTarget, depth + 1);
    if (resolvedTarget) {
      return resolvedTarget;
    }
  }
  return undefined;
};

const exportSpecifierFromKey = (
  packageName: string,
  key: string
): string | undefined => {
  if (key === '.') {
    return packageName;
  }
  if (!key.startsWith('./')) {
    return undefined;
  }
  return `${packageName}/${key.slice(2)}`;
};

const wildcardCaptureIsSafe = (capture: string): boolean =>
  !capture.includes('\\') &&
  capture.split('/').every(packageExportSegmentIsSafe);

const wildcardCapture = (
  pattern: string,
  value: string
): string | undefined => {
  const star = pattern.indexOf('*');
  if (star === -1) {
    return undefined;
  }

  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    return undefined;
  }

  const capture = value.slice(prefix.length, value.length - suffix.length);
  return capture.length > 0 && wildcardCaptureIsSafe(capture)
    ? capture
    : undefined;
};

const applyWildcardCapture = (targetPattern: string, capture: string): string =>
  targetPattern.replaceAll('*', capture);

type WildcardExportCandidate =
  | {
      readonly kind: 'target';
      readonly pattern: string;
      readonly target: string;
    }
  | { readonly kind: 'blocked'; readonly pattern: string };

/**
 * Order two wildcard export keys by Node's package-exports precedence: the
 * longer prefix before the wildcard wins first, then the longer total key. This
 * mirrors Node's `patternKeyCompare`, so equal-total-length patterns (for
 * example a leading-wildcard key versus a trailing-wildcard key) resolve the
 * way the runtime loader would.
 */
const patternKeyCompare = (left: string, right: string): number => {
  const leftBase = left.indexOf('*') + 1;
  const rightBase = right.indexOf('*') + 1;
  if (leftBase !== rightBase) {
    return rightBase - leftBase;
  }
  return right.length - left.length;
};

const resolveExportTargetForImport = (
  context: AdapterTargetParseContext,
  importSpecifier: string
): string | undefined => {
  // Exact `null` exclusions block the subpath before any wildcard fallback.
  if (context.blockedExportSpecifiers.includes(importSpecifier)) {
    return undefined;
  }

  const exactTarget = context.exportTargets[importSpecifier];
  if (exactTarget) {
    return exactTarget;
  }

  // Match the most specific wildcard key using Node's exports precedence
  // (longer prefix before the wildcard first, then longer total key). A blocked
  // pattern that is more specific than a broader target pattern must reject the
  // import instead of resolving it.
  const candidates: WildcardExportCandidate[] = [
    ...Object.entries(context.exportTargets)
      .filter(([specifier]) => specifier.includes('*'))
      .map(
        ([pattern, target]): WildcardExportCandidate => ({
          kind: 'target',
          pattern,
          target,
        })
      ),
    ...context.blockedExportSpecifiers
      .filter((specifier) => specifier.includes('*'))
      .map(
        (pattern): WildcardExportCandidate => ({ kind: 'blocked', pattern })
      ),
  ].toSorted((left, right) => patternKeyCompare(left.pattern, right.pattern));

  for (const candidate of candidates) {
    const capture = wildcardCapture(candidate.pattern, importSpecifier);
    if (capture === undefined) {
      continue;
    }
    return candidate.kind === 'blocked'
      ? undefined
      : applyWildcardCapture(candidate.target, capture);
  }

  return undefined;
};

interface NormalizedExportTargets {
  readonly blocked: readonly string[];
  readonly targets: Readonly<Record<string, string>>;
}

const normalizeExportTargets = (
  packageRoot: string,
  packageName: string,
  exportsValue: unknown
): NormalizedExportTargets => {
  if (!isRecord(exportsValue)) {
    return { blocked: [], targets: {} };
  }

  const targets: Record<string, string> = {};
  const blocked: string[] = [];
  for (const [key, value] of Object.entries(exportsValue)) {
    const specifier = exportSpecifierFromKey(packageName, key);
    if (!specifier) {
      continue;
    }
    const resolvedTarget = resolveExportTarget(value);
    if (resolvedTarget?.kind === 'target') {
      if (!exportTargetIsSafe(resolvedTarget.target)) {
        blocked.push(specifier);
        continue;
      }
      targets[specifier] = normalizeRealPath(
        join(packageRoot, resolvedTarget.target)
      );
      continue;
    }
    // A declared export key that does not resolve to a runtime target (an
    // explicit `null` exclusion, or a conditions object with no runtime
    // condition such as a `types`-only entry) blocks the subpath. Node selects
    // the most specific matching key and reports the subpath as not exported, so
    // it must not fall through to a broader wildcard.
    blocked.push(specifier);
  }
  return { blocked, targets };
};

const diagnostic = (
  context: AdapterTargetParseContext,
  code: AdapterTargetCatalogDiagnosticCode,
  message: string,
  target?: string
): AdapterTargetCatalogDiagnostic => ({
  code,
  message,
  packageJsonPath: context.packageJsonPath,
  packageName: context.packageName,
  ...(target === undefined ? {} : { target }),
});

const targetDiagnostic = (
  entry: AdapterTargetCatalogEntry,
  code: AdapterTargetCatalogDiagnosticCode,
  message: string
): AdapterTargetCatalogDiagnostic => ({
  code,
  message,
  packageJsonPath: entry.packageJsonPath,
  packageName: entry.ownerPackage,
  target: entry.target,
});

const rejectDuplicateTargetIds = (
  targets: readonly AdapterTargetCatalogEntry[]
): {
  readonly diagnostics: readonly AdapterTargetCatalogDiagnostic[];
  readonly targets: readonly AdapterTargetCatalogEntry[];
} => {
  const entriesByTarget = new Map<string, AdapterTargetCatalogEntry[]>();
  for (const entry of targets) {
    entriesByTarget.set(entry.target, [
      ...(entriesByTarget.get(entry.target) ?? []),
      entry,
    ]);
  }

  const duplicateTargets = new Set(
    [...entriesByTarget.entries()]
      .filter(([, entries]) => entries.length > 1)
      .map(([target]) => target)
  );

  return {
    diagnostics: [...entriesByTarget.values()]
      .filter((entries) => entries.length > 1)
      .flatMap((entries) =>
        entries.map((entry) =>
          targetDiagnostic(
            entry,
            'duplicate-adapter-target',
            `Adapter target "${entry.target}" is declared by multiple owner packages; target ids must be globally unique until adapter metadata can select an owner.`
          )
        )
      ),
    targets: targets.filter((entry) => !duplicateTargets.has(entry.target)),
  };
};

const isAdapterTargetPlacement = (
  value: unknown
): value is AdapterTargetPlacement =>
  typeof value === 'string' &&
  adapterTargetPlacements.includes(value as AdapterTargetPlacement);

const normalizePlacements = (
  value: unknown,
  context: AdapterTargetParseContext,
  target: string
): {
  readonly diagnostics: readonly AdapterTargetCatalogDiagnostic[];
  readonly placements: readonly AdapterTargetPlacement[];
} => {
  if (!Array.isArray(value)) {
    return {
      diagnostics: [
        diagnostic(
          context,
          'invalid-placement',
          `Adapter target "${target}" must declare placements as an array.`,
          target
        ),
      ],
      placements: [],
    };
  }

  const diagnostics: AdapterTargetCatalogDiagnostic[] = [];
  if (value.length === 0) {
    diagnostics.push(
      diagnostic(
        context,
        'invalid-placement',
        `Adapter target "${target}" must declare at least one placement.`,
        target
      )
    );
  }

  const placements = new Set<AdapterTargetPlacement>();
  for (const placement of value) {
    if (isAdapterTargetPlacement(placement)) {
      placements.add(placement);
      continue;
    }
    diagnostics.push(
      diagnostic(
        context,
        'invalid-placement',
        `Adapter target "${target}" has unsupported placement ${JSON.stringify(placement)}.`,
        target
      )
    );
  }

  return {
    diagnostics,
    placements: [...placements].toSorted(),
  };
};

const normalizeOptionalImport = (
  value: unknown,
  field: 'supportImport' | 'testingImport',
  context: AdapterTargetParseContext,
  target: string
): {
  readonly diagnostics: readonly AdapterTargetCatalogDiagnostic[];
  readonly importSpecifier?: string | undefined;
} => {
  if (value === undefined) {
    return { diagnostics: [] };
  }
  if (typeof value === 'string' && value.length > 0) {
    if (!value.startsWith(`${context.packageName}/`)) {
      return {
        diagnostics: [
          diagnostic(
            context,
            'invalid-import',
            `Adapter target "${target}" must declare ${field} as an owner package subpath inside ${context.packageName}.`,
            target
          ),
        ],
      };
    }

    return { diagnostics: [], importSpecifier: value };
  }
  return {
    diagnostics: [
      diagnostic(
        context,
        'invalid-import',
        `Adapter target "${target}" must declare ${field} as a non-empty string when present.`,
        target
      ),
    ],
  };
};

const normalizeConformance = (
  value: unknown,
  context: AdapterTargetParseContext,
  target: string,
  hasTestingImport: boolean
): {
  readonly diagnostics: readonly AdapterTargetCatalogDiagnostic[];
  readonly conformance?: AdapterTargetConformanceManifest | undefined;
} => {
  if (value === undefined) {
    return { diagnostics: [] };
  }

  if (!isRecord(value)) {
    return {
      diagnostics: [
        diagnostic(
          context,
          'invalid-conformance',
          `Adapter target "${target}" must declare conformance as an object when present.`,
          target
        ),
      ],
    };
  }

  const diagnostics: AdapterTargetCatalogDiagnostic[] = [];
  if (!hasTestingImport) {
    diagnostics.push(
      diagnostic(
        context,
        'invalid-conformance',
        `Adapter target "${target}" must declare testingImport before conformance helpers.`,
        target
      )
    );
  }

  const conformance: {
    adapterType?: string | undefined;
    casesFactory?: string | undefined;
    runner?: string | undefined;
  } = {};
  for (const field of ['adapterType', 'casesFactory', 'runner'] as const) {
    const fieldValue = value[field];
    if (
      typeof fieldValue === 'string' &&
      exportIdentifierPattern.test(fieldValue)
    ) {
      conformance[field] = fieldValue;
      continue;
    }
    diagnostics.push(
      diagnostic(
        context,
        'invalid-conformance',
        `Adapter target "${target}" must declare conformance.${field} as a valid named export.`,
        target
      )
    );
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  return {
    conformance: conformance as AdapterTargetConformanceManifest,
    diagnostics: [],
  };
};

const conformanceExportDiagnostics = (
  context: AdapterTargetParseContext,
  target: string,
  conformance: AdapterTargetConformanceManifest,
  testingExportTarget: string
): readonly AdapterTargetCatalogDiagnostic[] => {
  if (!existsSync(testingExportTarget)) {
    return [
      diagnostic(
        context,
        'invalid-conformance',
        `Adapter target "${target}" declares conformance helpers, but the testing export source could not be read.`,
        target
      ),
    ];
  }

  const diagnostics: AdapterTargetCatalogDiagnostic[] = [];
  for (const [field, identifier] of Object.entries(conformance) as [
    keyof AdapterTargetConformanceManifest,
    string,
  ][]) {
    const exportKind = adapterSourceExportKind(testingExportTarget, identifier);
    if (field === 'adapterType' && adapterSourceExportKindHasType(exportKind)) {
      continue;
    }
    if (
      field !== 'adapterType' &&
      adapterSourceExportKindHasValue(exportKind)
    ) {
      continue;
    }
    const expectedExport =
      field === 'adapterType' ? 'type export' : 'value export';
    diagnostics.push(
      diagnostic(
        context,
        'invalid-conformance',
        `Adapter target "${target}" declares conformance.${field} "${identifier}", but ${context.packageName} does not provide it as a ${expectedExport} from testingImport.`,
        target
      )
    );
  }

  return diagnostics;
};

const missingExportDiagnostic = (
  context: AdapterTargetParseContext,
  field: 'supportImport' | 'testingImport',
  importSpecifier: string,
  target: string
): AdapterTargetCatalogDiagnostic =>
  diagnostic(
    context,
    'invalid-import',
    `Adapter target "${target}" declares ${field} "${importSpecifier}", but ${context.packageName} does not export that subpath.`,
    target
  );

const missingExportTargetDiagnostic = (
  context: AdapterTargetParseContext,
  field: 'supportImport' | 'testingImport',
  importSpecifier: string,
  target: string
): AdapterTargetCatalogDiagnostic =>
  diagnostic(
    context,
    'invalid-import',
    `Adapter target "${target}" declares ${field} "${importSpecifier}", but ${context.packageName} exports that subpath to a missing or non-file target.`,
    target
  );

const adapterTargetsRecord = (
  manifest: AdapterTargetPackageManifest
): Record<string, unknown> | undefined | null => {
  const trails = isRecord(manifest.trails) ? manifest.trails : undefined;
  const adapterTargets = trails?.['adapterTargets'];
  if (adapterTargets === undefined) {
    return undefined;
  }
  return isRecord(adapterTargets) ? adapterTargets : null;
};

const parseCatalogTarget = (
  context: AdapterTargetParseContext,
  target: string,
  entry: unknown
): ParsedCatalogTarget => {
  if (!targetIdPattern.test(target) || !isRecord(entry)) {
    return {
      diagnostics: [
        diagnostic(
          context,
          'invalid-adapter-target',
          'Adapter target entries must use a kebab-case id and object value.',
          target
        ),
      ],
    };
  }

  const placements = normalizePlacements(entry['placements'], context, target);
  const supportImport = normalizeOptionalImport(
    entry['supportImport'],
    'supportImport',
    context,
    target
  );
  const testingImport = normalizeOptionalImport(
    entry['testingImport'],
    'testingImport',
    context,
    target
  );
  const conformance = normalizeConformance(
    entry['conformance'],
    context,
    target,
    testingImport.importSpecifier !== undefined
  );
  const importDiagnostics = [
    ...placements.diagnostics,
    ...supportImport.diagnostics,
    ...testingImport.diagnostics,
    ...conformance.diagnostics,
  ];
  const supportImportSpecifier = supportImport.importSpecifier;
  const supportExportTarget = supportImportSpecifier
    ? resolveExportTargetForImport(context, supportImportSpecifier)
    : undefined;
  const testingImportSpecifier = testingImport.importSpecifier;
  const conformanceManifest = conformance.conformance;
  const testingExportTarget = testingImportSpecifier
    ? resolveExportTargetForImport(context, testingImportSpecifier)
    : undefined;

  if (supportImportSpecifier) {
    if (!supportExportTarget) {
      importDiagnostics.push(
        missingExportDiagnostic(
          context,
          'supportImport',
          supportImportSpecifier,
          target
        )
      );
    } else if (!pathIsFile(supportExportTarget)) {
      importDiagnostics.push(
        missingExportTargetDiagnostic(
          context,
          'supportImport',
          supportImportSpecifier,
          target
        )
      );
    }
  }
  if (testingImportSpecifier) {
    if (!testingExportTarget) {
      importDiagnostics.push(
        missingExportDiagnostic(
          context,
          'testingImport',
          testingImportSpecifier,
          target
        )
      );
    } else if (!pathIsFile(testingExportTarget)) {
      importDiagnostics.push(
        missingExportTargetDiagnostic(
          context,
          'testingImport',
          testingImportSpecifier,
          target
        )
      );
    }
  }
  if (conformanceManifest && testingExportTarget) {
    importDiagnostics.push(
      ...conformanceExportDiagnostics(
        context,
        target,
        conformanceManifest,
        testingExportTarget
      )
    );
  }
  if (importDiagnostics.length > 0 || placements.placements.length === 0) {
    return { diagnostics: importDiagnostics };
  }

  return {
    diagnostics: [],
    targetEntry: {
      key: `${context.packageName}:${target}`,
      ownerPackage: context.packageName,
      packageJsonPath: context.packageJsonPath,
      packageRoot: context.packageRoot,
      placements: placements.placements,
      ...(supportImportSpecifier
        ? {
            ...(supportExportTarget ? { supportExportTarget } : {}),
            supportImport: supportImportSpecifier,
          }
        : {}),
      target,
      ...(testingImportSpecifier
        ? {
            ...(testingExportTarget ? { testingExportTarget } : {}),
            ...(conformanceManifest
              ? { conformance: conformanceManifest }
              : {}),
            testingImport: testingImportSpecifier,
          }
        : {}),
    },
  };
};

export const parseAdapterTargetsFromManifest = (
  manifest: AdapterTargetPackageManifest,
  context: AdapterTargetParseContext
): AdapterTargetCatalog => {
  const adapterTargets = adapterTargetsRecord(manifest);
  if (adapterTargets === undefined) {
    return { diagnostics: [], targets: [] };
  }
  if (adapterTargets === null) {
    return {
      diagnostics: [
        diagnostic(
          context,
          'invalid-adapter-targets',
          '`trails.adapterTargets` must be an object keyed by adapter target id.'
        ),
      ],
      targets: [],
    };
  }

  const diagnostics: AdapterTargetCatalogDiagnostic[] = [];
  const targets: AdapterTargetCatalogEntry[] = [];

  for (const [target, entry] of Object.entries(adapterTargets).toSorted()) {
    const parsedTarget = parseCatalogTarget(context, target, entry);
    diagnostics.push(...parsedTarget.diagnostics);
    if (parsedTarget.targetEntry) {
      targets.push(parsedTarget.targetEntry);
    }
  }

  return {
    diagnostics,
    targets,
  };
};

export const deriveAdapterTargetCatalog = (
  rootDir: string
): AdapterTargetCatalog => {
  const diagnostics: AdapterTargetCatalogDiagnostic[] = [];
  const targets: AdapterTargetCatalogEntry[] = [];

  for (const workspacePackage of listWorkspacePackages<NamedAdapterTargetPackageManifest>(
    rootDir
  )) {
    const { manifest, packageJsonPath, packageRoot } = workspacePackage;
    const normalizedExports = normalizeExportTargets(
      packageRoot,
      manifest.name,
      manifest.exports
    );
    const parsed = parseAdapterTargetsFromManifest(manifest, {
      blockedExportSpecifiers: normalizedExports.blocked,
      exportTargets: normalizedExports.targets,
      packageJsonPath,
      packageName: manifest.name,
      packageRoot,
    });
    diagnostics.push(...parsed.diagnostics);
    targets.push(...parsed.targets);
  }

  const sortedTargets = targets.toSorted((left, right) =>
    left.key.localeCompare(right.key)
  );
  const uniqueTargets = rejectDuplicateTargetIds(sortedTargets);

  return {
    diagnostics: [...diagnostics, ...uniqueTargets.diagnostics],
    targets: uniqueTargets.targets,
  };
};
