/**
 * `create.adapter` trail -- Scaffold an adapter authoring target.
 */

import {
  adapterTargetPlacements,
  checkAdapters,
  deriveAdapterTargetCatalog,
} from '@ontrails/adapter-kit';
import type {
  AdapterCheckDiagnostic,
  AdapterTargetCatalogEntry,
  AdapterTargetConformanceManifest,
  AdapterTargetPlacement,
} from '@ontrails/adapter-kit';
import { Result, trail, ValidationError } from '@ontrails/core';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';

import {
  applyProjectOperations,
  planProjectOperations,
  resolveProjectPath,
} from '../project-writes.js';
import type {
  PlannedProjectOperation,
  ProjectWriteOperation,
} from '../project-writes.js';
import { trailsPackageVersion } from '../versions.js';
import { resolveTrailRootDir } from './root-dir.js';

const adapterNamePattern = /^[a-z][a-z0-9-]*$/u;
const adapterNameMessage =
  'Adapter name must be kebab-case, start with a lowercase letter, and contain only lowercase letters, digits, or "-".';
const packageNamePattern =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const packageNameMessage =
  'Package name must be a valid lowercase npm package name, optionally scoped.';

type CreateAdapterPlacement = AdapterTargetPlacement;

const createAdapterPlacements = ['extracted'] as const;

interface CreateAdapterInput {
  readonly dryRun: boolean;
  readonly name: string;
  readonly packageName?: string | undefined;
  readonly placement: CreateAdapterPlacement;
  readonly rootDir?: string | undefined;
  readonly target: string;
}

interface CreateAdapterResult {
  readonly adapterImport: string;
  readonly created: readonly string[];
  readonly diagnostics: readonly AdapterCheckDiagnostic[];
  readonly dryRun: boolean;
  readonly packageName: string;
  readonly placement: CreateAdapterPlacement;
  readonly plannedOperations: readonly PlannedProjectOperation[];
  readonly targetKey: string;
}

interface AdapterOperationPlan {
  readonly adapterImport: string;
  readonly packageName: string;
  readonly operations: readonly ProjectWriteOperation[];
  readonly targetKey: string;
}

interface RootManifest {
  readonly workspaces?: unknown;
}

interface WorkspacePackageManifest {
  readonly exports?: unknown;
  readonly name?: unknown;
}

interface WorkspacePackageName {
  readonly name: string;
  readonly workspacePath: string;
}

interface LocalNamedReexport {
  readonly local: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

interface LocalNamedImport {
  readonly imported: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

const literal = (value: string): string => JSON.stringify(value);

const writeOperation = (
  path: string,
  content: string
): ProjectWriteOperation => ({
  content,
  kind: 'write',
  path,
});

const formatJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

const defaultExtractedPackageName = (name: string): string =>
  `@ontrails/${name}`;

const fail = (message: string): Result<never, ValidationError> =>
  Result.err(new ValidationError(message));

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

  const packages =
    workspaces && typeof workspaces === 'object' && !Array.isArray(workspaces)
      ? (workspaces as Record<string, unknown>)['packages']
      : undefined;
  return Array.isArray(packages)
    ? packages.filter(
        (pattern): pattern is string => typeof pattern === 'string'
      )
    : [];
};

const normalizeWorkspacePattern = (pattern: string): string =>
  pattern.replace(/^\.\//u, '').replace(/\/+$/u, '');

const workspacePatternCoversPath = (
  pattern: string,
  workspacePath: string
): boolean => {
  const normalized = normalizeWorkspacePattern(pattern);
  if (normalized.endsWith('/*')) {
    const prefix = normalized.slice(0, -2);
    const rest = workspacePath.slice(prefix.length + 1);
    return (
      workspacePath.startsWith(`${prefix}/`) &&
      rest.length > 0 &&
      !rest.includes('/')
    );
  }

  return normalized === workspacePath;
};

const rootWorkspaceIncludesPath = (
  rootDir: string,
  workspacePath: string
): boolean => {
  const rootManifest = readJson<RootManifest>(join(rootDir, 'package.json'));
  return workspacePatternsFromManifest(rootManifest).some((pattern) =>
    workspacePatternCoversPath(pattern, workspacePath)
  );
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

const findWorkspacePackageName = (
  rootDir: string,
  packageName: string
): WorkspacePackageName | undefined => {
  const rootManifest = readJson<RootManifest>(join(rootDir, 'package.json'));
  for (const pattern of workspacePatternsFromManifest(rootManifest)) {
    for (const workspaceDir of workspaceDirsForPattern(rootDir, pattern)) {
      const manifest = readJson<WorkspacePackageManifest>(
        join(workspaceDir, 'package.json')
      );
      if (manifest?.name === packageName) {
        return {
          name: packageName,
          workspacePath: relative(rootDir, workspaceDir),
        };
      }
    }
  }

  return undefined;
};

const resolvePhysicalRootDir = (
  rootDir: string
): Result<string, ValidationError> => {
  try {
    return Result.ok(realpathSync(resolve(rootDir)));
  } catch {
    return fail(
      `Workspace root "${rootDir}" does not exist or cannot be read.`
    );
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const runtimeExportTarget = (value: unknown, depth = 0): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (!isRecord(value) || depth > 8) {
    return undefined;
  }

  for (const condition of ['bun', 'import', 'default', 'require'] as const) {
    const candidate = runtimeExportTarget(value[condition], depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
};

const packageRootExportTarget = (
  target: AdapterTargetCatalogEntry
): string | undefined => {
  const manifest = readJson<WorkspacePackageManifest>(target.packageJsonPath);
  let exportTarget: string | undefined;
  if (typeof manifest?.exports === 'string') {
    exportTarget = manifest.exports;
  } else if (isRecord(manifest?.exports)) {
    const rootExport = Object.hasOwn(manifest.exports, '.')
      ? manifest.exports['.']
      : manifest.exports;
    exportTarget = runtimeExportTarget(rootExport);
  }

  if (!exportTarget || exportTarget.startsWith('..')) {
    return undefined;
  }

  return resolve(target.packageRoot, exportTarget);
};

const maskSource = (source: string, options: { strings: boolean }): string => {
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

const sameFileExportListLocalForIdentifier = (
  source: string,
  identifier: string,
  expected: 'type' | 'value'
): string | undefined => {
  const exportCode = maskSource(source, { strings: false });
  const stringsMaskedCode = maskSource(source, { strings: true });
  const exportListPattern =
    /\bexport\s+(?<typeOnly>type\s+)?\{(?<exports>[\s\S]*?)\}(?<from>\s+from\s+['"][^'"]+['"])?/gu;
  for (const match of exportCode.matchAll(exportListPattern)) {
    if (!stringsMaskedCode.startsWith('export', match.index ?? 0)) {
      continue;
    }

    if (match.groups?.['from']) {
      continue;
    }

    const namedExports = match.groups?.['exports'] ?? '';
    for (const item of namedExports.split(',')) {
      const trimmedItem = item.trim();
      const specifierTypeOnly =
        Boolean(match.groups?.['typeOnly']) || trimmedItem.startsWith('type ');
      const specifierText = trimmedItem.replace(/^type\s+/u, '');
      const exported =
        /^(?<local>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<name>[A-Za-z_$][\w$]*))?$/u.exec(
          specifierText
        )?.groups;
      if (
        !exported?.['local'] ||
        (exported['name'] ?? exported['local']) !== identifier
      ) {
        continue;
      }
      if (expected === 'type') {
        return exported['local'];
      }
      if (!specifierTypeOnly) {
        return exported['local'];
      }
    }
  }

  return undefined;
};

const declaresTypeBinding = (source: string, identifier: string): boolean => {
  const code = maskSource(source, { strings: true });
  const escapedIdentifier = identifier.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&'
  );
  return new RegExp(
    `(?:^|[;\\n\\r])\\s*(?:export\\s+)?(?:declare\\s+)?(?:interface|type)\\s+${escapedIdentifier}\\b`,
    'u'
  ).test(code);
};

const declaresValueBinding = (source: string, identifier: string): boolean => {
  const code = maskSource(source, { strings: true });
  const escapedIdentifier = identifier.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&'
  );
  return new RegExp(
    `(?:^|[;\\n\\r])\\s*(?:export\\s+)?(?:(?:async\\s+)?function|const|let|var|class|enum)\\s+${escapedIdentifier}\\b`,
    'u'
  ).test(code);
};

const sourceExportsIdentifier = (
  source: string,
  identifier: string,
  expected: 'type' | 'value'
): boolean => {
  const code = maskSource(source, { strings: true });
  const escapedIdentifier = identifier.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&'
  );
  const valueDeclarationPattern = new RegExp(
    `\\bexport\\s+(?:(?:async\\s+)?function|const|let|var|class|enum)\\s+${escapedIdentifier}\\b`,
    'u'
  );
  if (expected === 'value' && valueDeclarationPattern.test(code)) {
    return true;
  }

  const typeDeclarationPattern = new RegExp(
    `\\bexport\\s+(?:declare\\s+)?(?:interface|type)\\s+${escapedIdentifier}\\b`,
    'u'
  );
  const sameFileLocal = sameFileExportListLocalForIdentifier(
    source,
    identifier,
    expected
  );
  return (
    (expected === 'type' &&
      (typeDeclarationPattern.test(code) ||
        (sameFileLocal !== undefined &&
          declaresTypeBinding(source, sameFileLocal)))) ||
    (expected === 'value' &&
      sameFileLocal !== undefined &&
      declaresValueBinding(source, sameFileLocal))
  );
};

const localNamedImports = (
  source: string,
  identifier: string
): readonly LocalNamedImport[] => {
  const code = maskSource(source, { strings: false });
  const stringsMaskedCode = maskSource(source, { strings: true });
  const imports: LocalNamedImport[] = [];
  const pattern =
    /\bimport\s+(?<typeOnly>type\s+)?\{(?<imports>[\s\S]*?)\}\s+from\s+['"](?<specifier>[^'"]+)['"]/gu;

  for (const match of code.matchAll(pattern)) {
    if (!stringsMaskedCode.startsWith('import', match.index ?? 0)) {
      continue;
    }

    const specifier = match.groups?.['specifier'];
    if (!specifier?.startsWith('.')) {
      continue;
    }

    const namedImports = match.groups?.['imports'] ?? '';
    for (const item of namedImports.split(',')) {
      const trimmedItem = item.trim();
      if (!trimmedItem) {
        continue;
      }

      const specifierTypeOnly =
        Boolean(match.groups?.['typeOnly']) || trimmedItem.startsWith('type ');
      const specifierText = trimmedItem.replace(/^type\s+/u, '');
      const imported =
        /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/u.exec(
          specifierText
        )?.groups;
      if (
        !imported?.['imported'] ||
        (imported['local'] ?? imported['imported']) !== identifier
      ) {
        continue;
      }

      imports.push({
        imported: imported['imported'],
        specifier,
        typeOnly: specifierTypeOnly,
      });
    }
  }

  return imports;
};

const localNamedReexports = (
  source: string,
  identifier: string
): readonly LocalNamedReexport[] => {
  const code = maskSource(source, { strings: false });
  const stringsMaskedCode = maskSource(source, { strings: true });
  const exports: LocalNamedReexport[] = [];
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

    const namedExports = match.groups?.['exports'] ?? '';
    for (const item of namedExports.split(',')) {
      const trimmedItem = item.trim();
      if (!trimmedItem) {
        continue;
      }

      const specifierTypeOnly =
        Boolean(match.groups?.['typeOnly']) || trimmedItem.startsWith('type ');
      const specifierText = trimmedItem.replace(/^type\s+/u, '');
      const exported =
        /^(?<local>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<name>[A-Za-z_$][\w$]*))?$/u.exec(
          specifierText
        )?.groups;
      if (
        !exported?.['local'] ||
        (exported['name'] ?? exported['local']) !== identifier
      ) {
        continue;
      }

      exports.push({
        local: exported['local'],
        specifier,
        typeOnly: specifierTypeOnly,
      });
    }
  }

  return exports;
};

const localStarReexports = (
  source: string
): readonly { readonly specifier: string; readonly typeOnly: boolean }[] => {
  const code = maskSource(source, { strings: false });
  const stringsMaskedCode = maskSource(source, { strings: true });
  return [
    ...code.matchAll(
      /\bexport\s+(?<typeOnly>type\s+)?\*\s+from\s+['"](?<specifier>[^'"]+)['"]/gu
    ),
  ]
    .filter((match) => stringsMaskedCode.startsWith('export', match.index ?? 0))
    .map((match) => ({
      specifier: match.groups?.['specifier'] ?? '',
      typeOnly: Boolean(match.groups?.['typeOnly']),
    }))
    .filter((entry) => entry.specifier.startsWith('.'));
};

const resolveLocalModuleSpecifier = (
  sourcePath: string,
  specifier: string
): string | undefined => {
  const basePath = resolve(dirname(sourcePath), specifier);
  const candidates = [
    basePath,
    basePath.endsWith('.js') ? `${basePath.slice(0, -3)}.ts` : undefined,
    basePath.endsWith('.js') ? `${basePath.slice(0, -3)}.tsx` : undefined,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ].filter((candidate): candidate is string => candidate !== undefined);

  return candidates.find((candidate) => existsSync(candidate));
};

const sourcePathExportsIdentifier = (
  sourcePath: string,
  identifier: string,
  expected: 'type' | 'value',
  visited = new Set<string>()
): boolean => {
  const normalizedSourcePath = realpathSync(sourcePath);
  const visitKey = `${normalizedSourcePath}:${identifier}:${expected}`;
  if (visited.has(visitKey)) {
    return false;
  }
  visited.add(visitKey);

  const source = readFileSync(normalizedSourcePath, 'utf8');
  if (sourceExportsIdentifier(source, identifier, expected)) {
    return true;
  }

  const sameFileLocal = sameFileExportListLocalForIdentifier(
    source,
    identifier,
    expected
  );
  if (sameFileLocal) {
    for (const localImport of localNamedImports(source, sameFileLocal)) {
      if (expected === 'value' && localImport.typeOnly) {
        continue;
      }
      const targetPath = resolveLocalModuleSpecifier(
        normalizedSourcePath,
        localImport.specifier
      );
      if (
        targetPath &&
        sourcePathExportsIdentifier(
          targetPath,
          localImport.imported,
          expected,
          visited
        )
      ) {
        return true;
      }
    }
  }

  for (const reexport of localNamedReexports(source, identifier)) {
    if (expected === 'value' && reexport.typeOnly) {
      continue;
    }
    const targetPath = resolveLocalModuleSpecifier(
      normalizedSourcePath,
      reexport.specifier
    );
    if (
      targetPath &&
      sourcePathExportsIdentifier(targetPath, reexport.local, expected, visited)
    ) {
      return true;
    }
  }

  for (const reexport of localStarReexports(source)) {
    if (expected === 'value' && reexport.typeOnly) {
      continue;
    }
    const targetPath = resolveLocalModuleSpecifier(
      normalizedSourcePath,
      reexport.specifier
    );
    if (
      targetPath &&
      sourcePathExportsIdentifier(targetPath, identifier, expected, visited)
    ) {
      return true;
    }
  }

  return false;
};

const assertHttpOwnerSupport = (
  target: AdapterTargetCatalogEntry
): Result<void, ValidationError> => {
  const rootExportTarget = packageRootExportTarget(target);
  if (!rootExportTarget || !existsSync(rootExportTarget)) {
    return fail(
      `Adapter target "${target.key}" cannot use the HTTP create.adapter template because ${target.ownerPackage} does not expose a readable package root export.`
    );
  }

  const requiredExports = [
    ['createFetchHandler', 'value'],
    ['CreateFetchHandlerOptions', 'type'],
  ] as const;
  const missing = requiredExports.filter(
    ([identifier, expected]) =>
      !sourcePathExportsIdentifier(rootExportTarget, identifier, expected)
  );
  if (missing.length === 0) {
    return Result.ok();
  }

  return fail(
    `Adapter target "${target.key}" cannot use the HTTP create.adapter template because ${target.ownerPackage} does not export ${missing
      .map(([identifier]) => identifier)
      .join(' and ')} from its package root.`
  );
};

const assertHttpTemplate = (
  target: AdapterTargetCatalogEntry
): Result<void, ValidationError> => {
  if (target.target !== 'http') {
    return fail(
      `Adapter target "${target.target}" does not yet expose a create.adapter starter template.`
    );
  }

  return assertHttpOwnerSupport(target);
};

const assertConformanceScaffold = (
  target: AdapterTargetCatalogEntry
): Result<void, ValidationError> => {
  if (target.testingImport && target.conformance) {
    return Result.ok();
  }

  return fail(
    `Adapter target "${target.key}" does not declare testingImport and conformance metadata for scaffolded conformance.`
  );
};

const resolveTarget = (
  rootDir: string,
  target: string,
  placement: CreateAdapterPlacement
): Result<AdapterTargetCatalogEntry, ValidationError> => {
  const catalog = deriveAdapterTargetCatalog(rootDir);
  if (catalog.diagnostics.length > 0) {
    return fail(
      [
        'Adapter target catalog has diagnostics; fix them before scaffolding:',
        ...catalog.diagnostics.map((entry) => `- ${entry.message}`),
      ].join('\n')
    );
  }

  const entry = catalog.targets.find(
    (candidate) => candidate.target === target
  );
  if (entry === undefined) {
    return fail(`Unknown adapter target "${target}".`);
  }
  if (!entry.placements.includes(placement)) {
    return fail(
      `Adapter target "${entry.key}" does not support ${placement} placement.`
    );
  }

  const conformance = assertConformanceScaffold(entry);
  if (conformance.isErr()) {
    return conformance;
  }

  const template = assertHttpTemplate(entry);
  if (template.isErr()) {
    return template;
  }

  return Result.ok(entry);
};

const generateExtractedPackageJson = (
  packageName: string,
  target: AdapterTargetCatalogEntry
): string =>
  formatJson({
    dependencies: {
      '@ontrails/core': 'workspace:^',
    },
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
    },
    files: [
      'src/**/*.ts',
      '!src/**/__tests__/**',
      '!src/**/*.test.ts',
      '!src/**/*.test-d.ts',
      'README.md',
    ],
    name: packageName,
    peerDependencies: {
      [target.ownerPackage]: 'workspace:^',
    },
    scripts: {
      build: 'tsc -b',
      clean: 'rm -rf dist *.tsbuildinfo',
      lint: 'oxlint ./src',
      test: 'bun test',
      typecheck: 'tsc --noEmit',
    },
    trails: {
      adapter: {
        target: target.target,
      },
    },
    type: 'module',
    version: trailsPackageVersion,
  });

const generateExtractedTsconfig = (): string =>
  formatJson({
    compilerOptions: {
      outDir: 'dist',
      rootDir: 'src',
    },
    exclude: ['**/__tests__/**', '**/*.test.ts', 'dist'],
    extends: '../../tsconfig.json',
    include: ['src'],
  });

const generateTestTsconfig = (): string =>
  formatJson({
    compilerOptions: {
      noEmit: true,
      rootDir: './src',
      types: ['bun'],
    },
    exclude: [],
    extends: './tsconfig.json',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.ts'],
  });

const generateHttpExtractedIndex = (
  target: AdapterTargetCatalogEntry
): string =>
  `import type { Topo } from '@ontrails/core';
import { createFetchHandler } from ${literal(target.ownerPackage)};
import type { CreateFetchHandlerOptions } from ${literal(target.ownerPackage)};

export interface CreateAppOptions extends CreateFetchHandlerOptions {}

export const createApp = (
  graph: Topo,
  options: CreateAppOptions = {}
) => ({
  fetch: createFetchHandler(graph, options),
});
`;

const generateConformanceTest = (
  target: AdapterTargetCatalogEntry,
  adapterImport: string,
  createAppImportPath: string
): string => {
  const conformance = target.conformance as AdapterTargetConformanceManifest;
  return `import {
  ${conformance.casesFactory},
  ${conformance.runner},
} from ${literal(target.testingImport ?? '')};
import type { ${conformance.adapterType} } from ${literal(target.testingImport ?? '')};

import { createApp } from ${literal(createAppImportPath)};

const adapter = {
  createApp,
  name: ${literal(adapterImport)},
} satisfies ${conformance.adapterType};

await ${conformance.runner}(adapter, await ${conformance.casesFactory}());
`;
};

const generateReadme = (
  packageName: string,
  target: AdapterTargetCatalogEntry
): string =>
  `# ${packageName}

${packageName} is a Trails ${target.target} adapter scaffold.

## Validate

\`\`\`bash
bun test
bun run typecheck
bun run lint
trails adapter check --root-dir ../..
\`\`\`

The conformance test imports ${target.testingImport} so owner-authored cases stay current as ${target.ownerPackage} evolves.
`;

const buildExtractedPlan = (
  rootDir: string,
  input: CreateAdapterInput,
  target: AdapterTargetCatalogEntry
): Result<AdapterOperationPlan, Error> => {
  const packageName =
    input.packageName ?? defaultExtractedPackageName(input.name);
  if (!packageNamePattern.test(packageName)) {
    return fail(packageNameMessage);
  }
  const existingPackage = findWorkspacePackageName(rootDir, packageName);
  if (existingPackage) {
    return fail(
      `Workspace package name "${existingPackage.name}" already exists at ${existingPackage.workspacePath}.`
    );
  }

  const packageRootPath = `adapters/${input.name}`;
  if (!rootWorkspaceIncludesPath(rootDir, packageRootPath)) {
    return fail(
      `Root package.json workspaces must include "${packageRootPath}" or "adapters/*" before create.adapter can write an extracted adapter package.`
    );
  }

  const packageRoot = resolveProjectPath(rootDir, packageRootPath);
  if (packageRoot.isErr()) {
    return packageRoot;
  }
  if (existsSync(packageRoot.value)) {
    return fail(`Adapter package already exists at ${packageRootPath}.`);
  }

  const adapterImport = packageName;
  const operations = [
    writeOperation(
      `${packageRootPath}/package.json`,
      generateExtractedPackageJson(packageName, target)
    ),
    writeOperation(
      `${packageRootPath}/tsconfig.json`,
      generateExtractedTsconfig()
    ),
    writeOperation(
      `${packageRootPath}/tsconfig.tests.json`,
      generateTestTsconfig()
    ),
    writeOperation(
      `${packageRootPath}/README.md`,
      generateReadme(packageName, target)
    ),
    writeOperation(
      `${packageRootPath}/src/index.ts`,
      generateHttpExtractedIndex(target)
    ),
    writeOperation(
      `${packageRootPath}/src/__tests__/conformance.test.ts`,
      generateConformanceTest(target, adapterImport, '../index.js')
    ),
  ];

  return Result.ok({
    adapterImport,
    operations,
    packageName,
    targetKey: target.key,
  });
};

const buildSubpathPlan = (
  _rootDir: string,
  _input: CreateAdapterInput,
  _target: AdapterTargetCatalogEntry
): Result<AdapterOperationPlan, Error> =>
  fail(
    'Subpath adapter scaffolding is deferred until shared adapter checks discover subpath adapter subjects.'
  );

const buildOperationPlan = (
  rootDir: string,
  input: CreateAdapterInput,
  target: AdapterTargetCatalogEntry
): Result<AdapterOperationPlan, Error> =>
  input.placement === 'extracted'
    ? buildExtractedPlan(rootDir, input, target)
    : buildSubpathPlan(rootDir, input, target);

const runPlannedOperations = async (
  rootDir: string,
  operations: readonly ProjectWriteOperation[],
  dryRun: boolean
): Promise<Result<readonly PlannedProjectOperation[], Error>> =>
  dryRun
    ? planProjectOperations(rootDir, operations)
    : await applyProjectOperations(rootDir, operations);

export const createAdapterTrail = trail('create.adapter', {
  args: ['name'],
  blaze: async (input: CreateAdapterInput, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const physicalRootDir = resolvePhysicalRootDir(rootDirResult.value);
    if (physicalRootDir.isErr()) {
      return physicalRootDir;
    }
    const rootDir = physicalRootDir.value;
    const target = resolveTarget(rootDir, input.target, input.placement);
    if (target.isErr()) {
      return target;
    }

    const plan = buildOperationPlan(rootDir, input, target.value);
    if (plan.isErr()) {
      return plan;
    }

    const plannedOperations = await runPlannedOperations(
      rootDir,
      plan.value.operations,
      input.dryRun
    );
    if (plannedOperations.isErr()) {
      return plannedOperations;
    }

    const report = checkAdapters(rootDir);
    const created = input.dryRun
      ? []
      : plannedOperations.value
          .filter((operation) => operation.kind === 'write')
          .map((operation) => operation.path);

    return Result.ok({
      adapterImport: plan.value.adapterImport,
      created,
      diagnostics: [...report.diagnostics],
      dryRun: input.dryRun,
      packageName: plan.value.packageName,
      placement: 'extracted',
      plannedOperations: [...plannedOperations.value],
      targetKey: plan.value.targetKey,
    } satisfies CreateAdapterResult);
  },
  description: 'Scaffold an adapter package from adapter target catalog facts',
  fields: {
    placement: {
      options: [
        {
          hint: 'Standalone package under adapters/',
          label: 'Extracted',
          value: 'extracted',
        },
      ],
    },
  },
  input: z.object({
    dryRun: z
      .boolean()
      .default(false)
      .describe('Plan adapter scaffold writes without touching disk'),
    name: z
      .string()
      .regex(adapterNamePattern, adapterNameMessage)
      .describe('Adapter name, e.g. hono'),
    packageName: z
      .string()
      .regex(packageNamePattern, packageNameMessage)
      .optional()
      .describe('Package name for extracted adapter placement'),
    placement: z
      .enum(createAdapterPlacements)
      .default('extracted')
      .describe('Adapter placement'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    target: z.string().describe('Adapter target id, e.g. http'),
  }),
  intent: 'write',
  output: z.object({
    adapterImport: z.string(),
    created: z.array(z.string()).readonly(),
    diagnostics: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        packageJsonPath: z.string(),
        packageName: z.string().optional(),
        placement: z.enum(adapterTargetPlacements).optional(),
        severity: z.enum(['error', 'warn']),
        target: z.string().optional(),
      })
    ),
    dryRun: z.boolean(),
    packageName: z.string(),
    placement: z.enum(createAdapterPlacements),
    plannedOperations: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('mkdir'), path: z.string() }),
        z.object({
          from: z.string(),
          kind: z.literal('rename'),
          to: z.string(),
        }),
        z.object({ kind: z.literal('write'), path: z.string() }),
      ])
    ),
    targetKey: z.string(),
  }),
  permit: { scopes: ['project:write'] },
});
