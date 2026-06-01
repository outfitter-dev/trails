/**
 * Read-only adapter target catalog derivation.
 *
 * Owner packages author the few adapter facts package metadata cannot derive.
 * Tooling consumes those facts; runtime adapters must never import this
 * private package.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const adapterTargetPlacements = ['extracted', 'subpath'] as const;

export type AdapterTargetPlacementValue =
  (typeof adapterTargetPlacements)[number];

export type AdapterTargetPlacement = AdapterTargetPlacementValue;

export interface AdapterTargetManifestEntry {
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

interface RootManifest {
  readonly workspaces?: unknown;
}

export interface AdapterTargetPackageManifest {
  readonly exports?: unknown;
  readonly name?: unknown;
  readonly trails?: unknown;
}

export interface AdapterTargetParseContext {
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

const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

const workspacePatternsFromManifest = (
  manifest: RootManifest | undefined
): readonly string[] => {
  const { workspaces } = manifest ?? {};
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (pattern): pattern is string => typeof pattern === 'string'
    );
  }

  const packages = isRecord(workspaces) ? workspaces['packages'] : undefined;
  return Array.isArray(packages)
    ? packages.filter(
        (pattern): pattern is string => typeof pattern === 'string'
      )
    : [];
};

const workspaceDirsForPattern = (
  rootDir: string,
  pattern: string
): readonly string[] => {
  if (!pattern.endsWith('/*')) {
    const workspaceDir = join(rootDir, pattern);
    return existsSync(workspaceDir) ? [workspaceDir] : [];
  }

  const groupDir = join(rootDir, pattern.slice(0, -2));
  if (!existsSync(groupDir)) {
    return [];
  }

  return readdirSync(groupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(groupDir, entry.name))
    .toSorted();
};

const resolveExportTarget = (
  target: unknown,
  depth = 0
): string | undefined => {
  if (typeof target === 'string') {
    return target;
  }
  if (!isRecord(target) || depth > 8) {
    return undefined;
  }

  for (const condition of ['bun', 'import', 'default', 'require'] as const) {
    const resolvedTarget = resolveExportTarget(target[condition], depth + 1);
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
  if (!key.startsWith('./') || key.includes('*')) {
    return undefined;
  }
  return `${packageName}/${key.slice(2)}`;
};

const normalizeExportTargets = (
  packageRoot: string,
  packageName: string,
  exportsValue: unknown
): Readonly<Record<string, string>> => {
  if (!isRecord(exportsValue)) {
    return {};
  }

  const targets: Record<string, string> = {};
  for (const [key, value] of Object.entries(exportsValue)) {
    const specifier = exportSpecifierFromKey(packageName, key);
    const target = resolveExportTarget(value);
    if (!specifier || !target) {
      continue;
    }
    targets[specifier] = normalizeRealPath(join(packageRoot, target));
  }
  return targets;
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
  const importDiagnostics = [
    ...placements.diagnostics,
    ...supportImport.diagnostics,
    ...testingImport.diagnostics,
  ];
  const supportImportSpecifier = supportImport.importSpecifier;
  const supportExportTarget = supportImportSpecifier
    ? context.exportTargets[supportImportSpecifier]
    : undefined;
  const testingImportSpecifier = testingImport.importSpecifier;
  const testingExportTarget = testingImportSpecifier
    ? context.exportTargets[testingImportSpecifier]
    : undefined;

  if (supportImportSpecifier && !supportExportTarget) {
    importDiagnostics.push(
      missingExportDiagnostic(
        context,
        'supportImport',
        supportImportSpecifier,
        target
      )
    );
  }
  if (testingImportSpecifier && !testingExportTarget) {
    importDiagnostics.push(
      missingExportDiagnostic(
        context,
        'testingImport',
        testingImportSpecifier,
        target
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
  const normalizedRoot = normalizeRealPath(rootDir);
  const rootManifest = readJson<RootManifest>(
    join(normalizedRoot, 'package.json')
  );
  const diagnostics: AdapterTargetCatalogDiagnostic[] = [];
  const targets: AdapterTargetCatalogEntry[] = [];

  for (const pattern of workspacePatternsFromManifest(rootManifest)) {
    for (const workspaceDir of workspaceDirsForPattern(
      normalizedRoot,
      pattern
    )) {
      const packageJsonPath = join(workspaceDir, 'package.json');
      const manifest = readJson<AdapterTargetPackageManifest>(packageJsonPath);
      if (!manifest || typeof manifest.name !== 'string') {
        continue;
      }

      const packageRoot = normalizeRealPath(dirname(packageJsonPath));
      const parsed = parseAdapterTargetsFromManifest(manifest, {
        exportTargets: normalizeExportTargets(
          packageRoot,
          manifest.name,
          manifest.exports
        ),
        packageJsonPath: normalizeRealPath(packageJsonPath),
        packageName: manifest.name,
        packageRoot,
      });
      diagnostics.push(...parsed.diagnostics);
      targets.push(...parsed.targets);
    }
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
