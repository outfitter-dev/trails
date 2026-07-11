/**
 * `create.adapter` trail -- Scaffold an adapter authoring target.
 */

import {
  adapterSourceExportKind,
  adapterSourceExports,
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
import {
  findWorkspacePackage,
  listWorkspacePatterns,
  Result,
  trail,
  ValidationError,
} from '@ontrails/core';
import type { WorkspaceRootManifest } from '@ontrails/core';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
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

const createAdapterPlacements = adapterTargetPlacements;

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

interface WorkspacePackageManifest {
  readonly exports?: unknown;
  readonly name?: unknown;
  readonly trails?: unknown;
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
  const rootManifest = readJson<WorkspaceRootManifest>(
    join(rootDir, 'package.json')
  );
  return listWorkspacePatterns(rootManifest).some((pattern) =>
    workspacePatternCoversPath(pattern, workspacePath)
  );
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

const toMutableRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? { ...value } : {};

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

const relativeImportSpecifier = (fromFile: string, toFile: string): string => {
  const withoutExtension = relative(dirname(fromFile), toFile)
    .replaceAll('\\', '/')
    .replace(/\.ts$/u, '.js');
  return withoutExtension.startsWith('.')
    ? withoutExtension
    : `./${withoutExtension}`;
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
    ['createFetchHandler', 'value', false],
    ['CreateFetchHandlerOptions', 'type', true],
  ] as const;
  const missing = requiredExports.filter(([identifier, expected, typeOnly]) => {
    if (typeOnly) {
      const exportKind = adapterSourceExportKind(rootExportTarget, identifier);
      return (
        exportKind !== 'type' &&
        exportKind !== 'interface-value' &&
        exportKind !== 'interface-value-erased' &&
        exportKind !== 'type-alias-value' &&
        exportKind !== 'type-alias-value-erased'
      );
    }
    return !adapterSourceExports(rootExportTarget, identifier, expected);
  });
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

const generateHttpSubpathIndex = (supportImportPath: string): string =>
  `import type { Topo } from '@ontrails/core';
import { createFetchHandler } from ${literal(supportImportPath)};
import type { CreateFetchHandlerOptions } from ${literal(supportImportPath)};

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
  const existingPackage = findWorkspacePackage<WorkspacePackageManifest>(
    rootDir,
    packageName
  );
  if (existingPackage) {
    return fail(
      `Workspace package name "${packageName}" already exists at ${existingPackage.workspacePath}.`
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
  rootDir: string,
  input: CreateAdapterInput,
  target: AdapterTargetCatalogEntry
): Result<AdapterOperationPlan, Error> => {
  if (input.packageName !== undefined) {
    return fail(
      'packageName is only supported for extracted adapter placement.'
    );
  }

  const ownerPackage = findWorkspacePackage<WorkspacePackageManifest>(
    rootDir,
    target.ownerPackage
  );
  if (!ownerPackage) {
    return fail(
      `Adapter target "${target.key}" owner package ${target.ownerPackage} is not a workspace package.`
    );
  }

  const manifest = readJson<WorkspacePackageManifest>(
    ownerPackage.packageJsonPath
  );
  if (!manifest || !isRecord(manifest)) {
    return fail(
      `Adapter target "${target.key}" owner package manifest could not be read.`
    );
  }

  const manifestExports = manifest['exports'];
  if (
    manifestExports !== undefined &&
    typeof manifestExports !== 'string' &&
    !isRecord(manifestExports)
  ) {
    return fail(
      `${target.ownerPackage} package.json exports must be an object before create.adapter can add a subpath adapter.`
    );
  }

  const exportKey = `./${input.name}`;
  const packageExports =
    typeof manifestExports === 'string'
      ? { '.': manifestExports }
      : toMutableRecord(manifestExports);
  if (Object.hasOwn(packageExports, exportKey)) {
    return fail(`${target.ownerPackage} already exports "${exportKey}".`);
  }

  const manifestTrails = manifest['trails'];
  const trails = toMutableRecord(manifestTrails);
  if (manifestTrails !== undefined && !isRecord(manifestTrails)) {
    return fail(
      `${target.ownerPackage} package.json trails must be an object.`
    );
  }

  const adapters = toMutableRecord(trails['adapters']);
  if (trails['adapters'] !== undefined && !isRecord(trails['adapters'])) {
    return fail(
      `${target.ownerPackage} package.json trails.adapters must be an object before create.adapter can add a subpath adapter.`
    );
  }
  if (Object.hasOwn(adapters, exportKey)) {
    return fail(
      `${target.ownerPackage} package.json trails.adapters already declares "${exportKey}".`
    );
  }

  const sourcePath = `${ownerPackage.workspacePath}/src/${input.name}/index.ts`;
  const sourceRoot = resolveProjectPath(
    rootDir,
    `${ownerPackage.workspacePath}/src/${input.name}`
  );
  if (sourceRoot.isErr()) {
    return sourceRoot;
  }
  if (existsSync(sourceRoot.value)) {
    return fail(
      `Subpath adapter source already exists at ${ownerPackage.workspacePath}/src/${input.name}.`
    );
  }

  const supportTarget = packageRootExportTarget(target);
  if (!supportTarget) {
    return fail(
      `Adapter target "${target.key}" cannot use the HTTP subpath template because ${target.ownerPackage} does not expose a readable package root export.`
    );
  }

  packageExports[exportKey] = `./src/${input.name}/index.ts`;
  adapters[exportKey] = { target: target.target };
  trails['adapters'] = adapters;

  const adapterImport = `${target.ownerPackage}/${input.name}`;
  const sourceFile = resolve(rootDir, sourcePath);
  const packageJson = formatJson({
    ...manifest,
    exports: packageExports,
    trails,
  });
  const operations = [
    writeOperation(`${ownerPackage.workspacePath}/package.json`, packageJson),
    writeOperation(
      sourcePath,
      generateHttpSubpathIndex(
        relativeImportSpecifier(sourceFile, supportTarget)
      )
    ),
    writeOperation(
      `${ownerPackage.workspacePath}/src/${input.name}/__tests__/conformance.test.ts`,
      generateConformanceTest(target, adapterImport, '../index.js')
    ),
  ];

  return Result.ok({
    adapterImport,
    operations,
    packageName: adapterImport,
    targetKey: target.key,
  });
};

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
  description: 'Scaffold an adapter package from adapter target catalog facts',
  fields: {
    placement: {
      options: [
        {
          hint: 'Standalone package under adapters/',
          label: 'Extracted',
          value: 'extracted',
        },
        {
          hint: 'Owner package subpath export',
          label: 'Subpath',
          value: 'subpath',
        },
      ],
    },
  },
  implementation: async (input: CreateAdapterInput, ctx) => {
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
      placement: input.placement,
      plannedOperations: [...plannedOperations.value],
      targetKey: plan.value.targetKey,
    } satisfies CreateAdapterResult);
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
