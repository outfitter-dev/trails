/**
 * Read-only adapter target catalog derivation.
 *
 * Owner packages author the few adapter facts package metadata cannot derive.
 * Tooling consumes those facts; runtime adapters must never import this
 * internal tooling package.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

interface RootManifest {
  readonly workspaces?: unknown;
}

export interface AdapterTargetPackageManifest {
  readonly exports?: unknown;
  readonly name?: unknown;
  readonly trails?: unknown;
}

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

type ExportKind = 'type' | 'type-value' | 'value';

interface StarExportSpecifier {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

interface NamedExportSpecifier {
  readonly identifier: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

interface NamedImportSpecifier {
  readonly identifier: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

interface ExportListSpecifier {
  readonly exported: string;
  readonly local: string;
  readonly typeOnly: boolean;
}

type ImportKindResolver = (
  importSpecifier: NamedImportSpecifier
) => ExportKind | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const targetIdPattern = /^[a-z][a-z0-9-]*$/u;
const exportIdentifierPattern = /^[A-Za-z_$][\w$]*$/u;

const exportKindHasType = (kind: ExportKind | undefined): boolean =>
  kind === 'type' || kind === 'type-value';

const exportKindHasValue = (kind: ExportKind | undefined): boolean =>
  kind === 'value' || kind === 'type-value';

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

const localDeclarationKind = (
  code: string,
  identifier: string,
  exportedOnly = false
): ExportKind | undefined => {
  const escapedIdentifier = identifier.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&'
  );
  const exportPrefix = exportedOnly ? '\\bexport\\s+' : '\\b(?:export\\s+)?';
  const valueDeclarationPattern = new RegExp(
    `${exportPrefix}(?!declare\\s+)(?:(?:async\\s+)?function|const|let|var)\\s+${escapedIdentifier}\\b`,
    'u'
  );
  if (valueDeclarationPattern.test(code)) {
    return 'value';
  }

  const typeValueDeclarationPattern = new RegExp(
    `${exportPrefix}(?!declare\\s+)(?:abstract\\s+)?(?:class|enum)\\s+${escapedIdentifier}\\b`,
    'u'
  );
  if (typeValueDeclarationPattern.test(code)) {
    return 'type-value';
  }

  const typeDeclarationPattern = new RegExp(
    `${exportPrefix}(?:declare\\s+)?(?:interface|type)\\s+${escapedIdentifier}\\b`,
    'u'
  );
  return typeDeclarationPattern.test(code) ? 'type' : undefined;
};

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

const maskDeadSourceText = (
  source: string,
  options: { strings: boolean }
): string => {
  const output = [...source];
  let index = 0;

  const maskRange = (start: number, end: number): void => {
    for (let cursor = start; cursor < end; cursor += 1) {
      if (output[cursor] !== '\n') {
        output[cursor] = ' ';
      }
    }
  };

  const skipQuoted = (quote: '"' | "'" | '`'): void => {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === quote) {
        index += 1;
        break;
      }
      index += 1;
    }
    if (options.strings) {
      maskRange(start, index);
    }
  };

  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2);
      const stop = end === -1 ? source.length : end;
      maskRange(index, stop);
      index = stop;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      maskRange(index, stop);
      index = stop;
      continue;
    }
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      skipQuoted(char);
      continue;
    }
    index += 1;
  }

  return output.join('');
};

const defaultExportKind = (source: string): ExportKind | undefined => {
  const code = maskDeadSourceText(source, { strings: true });
  if (/\bexport\s+default\s+(?:async\s+)?function\*?\b/u.test(code)) {
    return 'value';
  }
  if (/\bexport\s+default\s+(?:abstract\s+)?(?:class|enum)\b/u.test(code)) {
    return 'type-value';
  }
  if (/\bexport\s+default\s+(?:interface|type)\b/u.test(code)) {
    return 'type';
  }

  const expressionIdentifier =
    /\bexport\s+default\s+(?<identifier>[A-Za-z_$][\w$]*)\b/u.exec(code)
      ?.groups?.['identifier'];
  if (expressionIdentifier) {
    return localDeclarationKind(code, expressionIdentifier) ?? 'value';
  }

  return /\bexport\s+default\b/u.test(code) ? 'value' : undefined;
};

const localDefaultImportSpecifier = (
  code: string,
  stringsMaskedCode: string,
  identifier: string
): NamedImportSpecifier | undefined => {
  const pattern =
    /\bimport\s+(?<importTypeOnly>type\s+)?(?<local>[A-Za-z_$][\w$]*)(?:\s*,\s*(?:\{[\s\S]*?\}|\*\s+as\s+[A-Za-z_$][\w$]*))?\s+from\s+['"](?<specifier>[^'"]+)['"]/gu;

  for (const match of code.matchAll(pattern)) {
    if (!stringsMaskedCode.startsWith('import', match.index ?? 0)) {
      continue;
    }
    if (match.groups?.['local'] !== identifier) {
      continue;
    }

    return {
      identifier: 'default',
      specifier: match.groups?.['specifier'] ?? '',
      typeOnly: Boolean(match.groups?.['importTypeOnly']),
    };
  }

  return undefined;
};

const parseNamedImportSpecifier = (
  item: string,
  declarationTypeOnly: boolean,
  specifier: string,
  identifier: string
): NamedImportSpecifier | undefined => {
  const trimmedItem = item.trim();
  if (!trimmedItem) {
    return undefined;
  }

  const itemTypeOnly = declarationTypeOnly || trimmedItem.startsWith('type ');
  const specifierText = trimmedItem.replace(/^type\s+/u, '');
  const imported =
    /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/u.exec(
      specifierText
    )?.groups;
  const local = imported?.['local'] ?? imported?.['imported'];
  const importedName = imported?.['imported'];
  if (local !== identifier || !importedName) {
    return undefined;
  }

  return {
    identifier: importedName,
    specifier,
    typeOnly: itemTypeOnly,
  };
};

const localNamedImportSpecifier = (
  source: string,
  identifier: string
): NamedImportSpecifier | undefined => {
  const code = maskDeadSourceText(source, { strings: false });
  const stringsMaskedCode = maskDeadSourceText(source, { strings: true });
  const defaultSpecifier = localDefaultImportSpecifier(
    code,
    stringsMaskedCode,
    identifier
  );
  if (defaultSpecifier) {
    return defaultSpecifier;
  }

  const pattern =
    /\bimport\s+(?<importTypeOnly>type\s+)?\{(?<imports>[\s\S]*?)\}\s+from\s+['"](?<specifier>[^'"]+)['"]/gu;

  for (const match of code.matchAll(pattern)) {
    if (!stringsMaskedCode.startsWith('import', match.index ?? 0)) {
      continue;
    }

    const declarationTypeOnly = Boolean(match.groups?.['importTypeOnly']);
    const namedImports = match.groups?.['imports'] ?? '';
    const specifier = match.groups?.['specifier'] ?? '';
    for (const item of namedImports.split(',')) {
      const namedSpecifier = parseNamedImportSpecifier(
        item,
        declarationTypeOnly,
        specifier,
        identifier
      );
      if (namedSpecifier) {
        return namedSpecifier;
      }
    }
  }

  return undefined;
};

const parseExportListSpecifier = (
  item: string,
  declarationTypeOnly: boolean
): ExportListSpecifier | undefined => {
  const trimmedItem = item.trim();
  if (!trimmedItem) {
    return undefined;
  }

  const typeOnly = declarationTypeOnly || trimmedItem.startsWith('type ');
  const specifierText = trimmedItem.replace(/^type\s+/u, '');
  const exported =
    /^(?<local>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<name>[A-Za-z_$][\w$]*))?$/u.exec(
      specifierText
    )?.groups;
  const local = exported?.['local'];
  if (!local) {
    return undefined;
  }

  return {
    exported: exported?.['name'] ?? local,
    local,
    typeOnly,
  };
};

const exportedLocalBindingKind = (
  source: string,
  code: string,
  local: string,
  resolveImportKind: ImportKindResolver
): ExportKind | undefined => {
  const localKind = localDeclarationKind(code, local);
  if (localKind) {
    return localKind;
  }

  const importSpecifier = localNamedImportSpecifier(source, local);
  if (importSpecifier?.typeOnly) {
    return 'type';
  }
  return importSpecifier ? resolveImportKind(importSpecifier) : undefined;
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

const namedExportKind = (
  source: string,
  identifier: string,
  resolveImportKind: ImportKindResolver
): ExportKind | undefined => {
  if (identifier === 'default') {
    const defaultKind = defaultExportKind(source);
    if (defaultKind) {
      return defaultKind;
    }
  }

  const code = maskDeadSourceText(source, { strings: true });
  const directKind = localDeclarationKind(code, identifier, true);
  if (directKind) {
    return directKind;
  }

  const exportListPattern =
    /\bexport\s+(?<typeOnly>type\s+)?\{(?<exports>[\s\S]*?)\}(?!\s+from\b)/gu;

  for (const match of code.matchAll(exportListPattern)) {
    const declarationTypeOnly = Boolean(match.groups?.['typeOnly']);
    const namedExports = match.groups?.['exports'] ?? '';
    for (const item of namedExports.split(',')) {
      const exported = parseExportListSpecifier(item, declarationTypeOnly);
      if (exported?.exported !== identifier) {
        continue;
      }

      const localKind = exportedLocalBindingKind(
        source,
        code,
        exported.local,
        resolveImportKind
      );
      if (!localKind) {
        return undefined;
      }
      return exported.typeOnly ? 'type' : localKind;
    }
  }

  return undefined;
};

const starExportSpecifiers = (
  source: string
): readonly StarExportSpecifier[] => {
  const code = maskDeadSourceText(source, { strings: false });
  const stringsMaskedCode = maskDeadSourceText(source, { strings: true });
  return [
    ...code.matchAll(
      /\bexport\s+(?<typeOnly>type\s+)?\*\s+from\s+['"](?<specifier>[^'"]+)['"]/gu
    ),
  ]
    .filter((match) => stringsMaskedCode.startsWith('export', match.index ?? 0))
    .map((match) => ({
      specifier: match.groups?.['specifier'] ?? '',
      typeOnly: Boolean(match.groups?.['typeOnly']),
    }));
};

const namedExportSpecifiers = (
  source: string,
  identifier: string
): readonly NamedExportSpecifier[] => {
  const code = maskDeadSourceText(source, { strings: false });
  const stringsMaskedCode = maskDeadSourceText(source, { strings: true });
  const exports: NamedExportSpecifier[] = [];
  const pattern =
    /\bexport\s+(?<typeOnly>type\s+)?\{(?<exports>[\s\S]*?)\}\s+from\s+['"](?<specifier>[^'"]+)['"]/gu;

  for (const match of code.matchAll(pattern)) {
    if (!stringsMaskedCode.startsWith('export', match.index ?? 0)) {
      continue;
    }

    const specifier = match.groups?.['specifier'];
    if (!specifier?.startsWith('.')) {
      continue;
    }

    const declarationTypeOnly = Boolean(match.groups?.['typeOnly']);
    const namedExports = match.groups?.['exports'] ?? '';
    for (const item of namedExports.split(',')) {
      const trimmedItem = item.trim();
      if (!trimmedItem) {
        continue;
      }

      const itemTypeOnly =
        declarationTypeOnly || trimmedItem.startsWith('type ');
      const specifierText = trimmedItem.replace(/^type\s+/u, '');
      const exported =
        /^(?<local>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<name>[A-Za-z_$][\w$]*))?$/u.exec(
          specifierText
        )?.groups;
      const local = exported?.['local'];
      if (!local || (exported?.['name'] ?? local) !== identifier) {
        continue;
      }

      exports.push({
        identifier: local,
        specifier,
        typeOnly: itemTypeOnly,
      });
    }
  }

  return exports;
};

const resolveLocalModuleSpecifier = (
  sourcePath: string,
  specifier: string
): string | undefined => {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const basePath = resolve(dirname(sourcePath), specifier);
  const candidates = [
    basePath,
    basePath.endsWith('.js') ? `${basePath.slice(0, -3)}.ts` : undefined,
    basePath.endsWith('.js') ? `${basePath.slice(0, -3)}.tsx` : undefined,
    basePath.endsWith('.mjs') ? `${basePath.slice(0, -4)}.mts` : undefined,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ].filter((candidate): candidate is string => candidate !== undefined);

  return candidates.find((candidate) => existsSync(candidate));
};

const namedExportKindFromFile = (
  sourcePath: string,
  identifier: string,
  visited = new Set<string>()
): ExportKind | undefined => {
  const normalizedSourcePath = normalizeRealPath(sourcePath);
  const visitKey = `${normalizedSourcePath}:${identifier}`;
  if (visited.has(visitKey)) {
    return undefined;
  }
  visited.add(visitKey);

  let source: string;
  try {
    source = readFileSync(normalizedSourcePath, 'utf8');
  } catch {
    return undefined;
  }

  const directKind = namedExportKind(source, identifier, (importSpecifier) => {
    const importTarget = resolveLocalModuleSpecifier(
      normalizedSourcePath,
      importSpecifier.specifier
    );
    if (!importTarget) {
      return;
    }
    return namedExportKindFromFile(
      importTarget,
      importSpecifier.identifier,
      new Set(visited)
    );
  });
  if (directKind) {
    return directKind;
  }

  let sawTypeExport = false;
  for (const exportSpecifier of namedExportSpecifiers(source, identifier)) {
    const exportTarget = resolveLocalModuleSpecifier(
      normalizedSourcePath,
      exportSpecifier.specifier
    );
    if (!exportTarget) {
      continue;
    }

    const reexportedKind = namedExportKindFromFile(
      exportTarget,
      exportSpecifier.identifier,
      new Set(visited)
    );
    if (exportKindHasValue(reexportedKind) && !exportSpecifier.typeOnly) {
      return reexportedKind;
    }
    if (exportKindHasType(reexportedKind)) {
      sawTypeExport = true;
    }
  }

  for (const exportSpecifier of starExportSpecifiers(source)) {
    const exportTarget = resolveLocalModuleSpecifier(
      normalizedSourcePath,
      exportSpecifier.specifier
    );
    if (!exportTarget) {
      continue;
    }

    const reexportedKind = namedExportKindFromFile(
      exportTarget,
      identifier,
      new Set(visited)
    );
    if (exportKindHasValue(reexportedKind) && !exportSpecifier.typeOnly) {
      return reexportedKind;
    }
    if (exportKindHasType(reexportedKind)) {
      sawTypeExport = true;
    }
  }

  return sawTypeExport ? 'type' : undefined;
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
    const exportKind = namedExportKindFromFile(testingExportTarget, identifier);
    if (field === 'adapterType' && exportKindHasType(exportKind)) {
      continue;
    }
    if (field !== 'adapterType' && exportKindHasValue(exportKind)) {
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
      const normalizedExports = normalizeExportTargets(
        packageRoot,
        manifest.name,
        manifest.exports
      );
      const parsed = parseAdapterTargetsFromManifest(manifest, {
        blockedExportSpecifiers: normalizedExports.blocked,
        exportTargets: normalizedExports.targets,
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
