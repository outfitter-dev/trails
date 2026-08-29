/**
 * `add.surface` trail -- Add a surface to an existing project.
 *
 * Generates surface entry points and updates package.json dependencies.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { isPlainObject, Result, trail, ValidationError } from '@ontrails/core';
import ts from 'typescript';
import { z } from 'zod';

import {
  projectPathExists,
  resolveProjectPath,
  writeProjectFile,
} from '../project-writes.js';
import { ontrailsPackageRange } from '../versions.js';
import { findTopoPath } from './project.js';
import { stringifyScaffoldPackageJson } from './scaffold-json.js';

type Surface = 'cli' | 'http' | 'mcp';
type SurfaceEntryRoot = 'bin' | 'src';

interface FileSystemEntries {
  readonly directories: string[];
  readonly files: string[];
}

type MatchTypeScriptFiles = (
  path: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  useCaseSensitiveFileNames: boolean,
  currentDirectory: string,
  depth: number | undefined,
  getFileSystemEntries: (path: string) => FileSystemEntries,
  realpath: (path: string) => string
) => string[];

const auditedTypeScriptVersion = '5.9.3';
const auditedMatchFilesArity = 9;

/**
 * TypeScript's public config host trusts readDirectory results without matching
 * virtual paths again. Keep this pinned runtime seam private so TypeScript still
 * owns prospective include/exclude/files semantics instead of Trails parsing globs.
 */
const matchTypeScriptFiles = (
  ts as typeof ts & { readonly matchFiles?: MatchTypeScriptFiles }
).matchFiles;

const readAuditedTypeScriptMatcher = (): Result<
  MatchTypeScriptFiles,
  Error
> => {
  if (ts.version !== auditedTypeScriptVersion) {
    return Result.err(
      new ValidationError(
        'TypeScript runtime is not audited for prospective surface matching.',
        {
          context: {
            actualVersion: ts.version,
            expectedVersion: auditedTypeScriptVersion,
            reason: 'typescript-prospective-matcher-version-mismatch',
          },
        }
      )
    );
  }
  if (typeof matchTypeScriptFiles !== 'function') {
    return Result.err(
      new ValidationError(
        'Pinned TypeScript runtime cannot match prospective surface entry paths.',
        {
          context: {
            reason: 'typescript-prospective-matcher-unavailable',
          },
        }
      )
    );
  }
  if (matchTypeScriptFiles.length !== auditedMatchFilesArity) {
    return Result.err(
      new ValidationError(
        'Pinned TypeScript runtime has an incompatible prospective surface matcher.',
        {
          context: {
            actualArity: matchTypeScriptFiles.length,
            expectedArity: auditedMatchFilesArity,
            reason: 'typescript-prospective-matcher-incompatible',
          },
        }
      )
    );
  }
  return Result.ok(matchTypeScriptFiles);
};

const generateCliEntry = (appImportPath: string): string =>
  `import { resolveTrailsOverlays } from '@ontrails/adapter-kit';
import { devPermitPreset, permitPreset } from '@ontrails/cli';
import { surface } from '@ontrails/commander';

import * as appModule from '${appImportPath}';

const { app } = appModule;
const overlays = resolveTrailsOverlays(appModule, '${appImportPath}');

await surface(app, {
  overlays,
  presets: [permitPreset(), devPermitPreset()],
});
`;

const generateMcpEntry = (appImportPath: string): string =>
  `import { resolveTrailsOverlays } from '@ontrails/adapter-kit';
import { surface } from '@ontrails/mcp';

import * as appModule from '${appImportPath}';

const { app } = appModule;
const overlays = resolveTrailsOverlays(appModule, '${appImportPath}');

await surface(app, { overlays });
`;

const generateHttpEntry = (appImportPath: string): string =>
  `import { surface } from '@ontrails/hono';

import { app } from '${appImportPath}';

await surface(app, { port: 3000 });
`;

const surfaceEntryNames = {
  cli: 'cli.ts',
  http: 'http.ts',
  mcp: 'mcp.ts',
} satisfies Record<Surface, string>;

const surfaceEntryRoots = [
  'bin',
  'src',
] as const satisfies readonly SurfaceEntryRoot[];

const surfaceDependencies = {
  cli: ['@ontrails/cli', '@ontrails/commander', '@ontrails/adapter-kit'],
  http: ['@ontrails/hono', '@ontrails/http'],
  mcp: ['@ontrails/mcp', '@ontrails/adapter-kit'],
} satisfies Record<Surface, readonly string[]>;

/** Resolve the entry file for a surface. */
const getEntryFile = (surface: Surface, entryRoot: SurfaceEntryRoot): string =>
  `${entryRoot}/${surfaceEntryNames[surface]}`;

interface ConfiguredTypeScriptLayout {
  readonly incompatibilities: ReadonlyMap<
    SurfaceEntryRoot,
    readonly TypeScriptSyntaxIncompatibility[]
  >;
  readonly rootDir: string | null;
  readonly supportedEntryRoots: ReadonlySet<SurfaceEntryRoot>;
}

interface SurfaceEntryResolutionOptions {
  readonly projectedLocalTsconfig?: boolean;
  readonly projectedPackageTypeModule?: boolean;
}

interface TypeScriptSyntaxIncompatibility {
  readonly code: number;
  readonly configPath: string;
  readonly message: string;
}

const canonicalLintEntryRoots = new Map<string, ReadonlySet<SurfaceEntryRoot>>([
  ['oxlint ./bin', new Set(['bin'])],
  ['oxlint ./src', new Set(['src'])],
  ['oxlint ./src ./bin', new Set(['bin', 'src'])],
]);

/**
 * Recognize a lint command the scaffolder owns, including the narrower entry
 * scopes earlier generations produced.
 */
export const isCanonicalLintCommand = (command: string): boolean =>
  canonicalLintEntryRoots.has(command);

const normalizeForComparison = (path: string): string =>
  ts.sys.useCaseSensitiveFileNames
    ? resolve(path)
    : resolve(path).toLowerCase();

const isWithinDirectory = (directory: string, path: string): boolean => {
  const pathFromDirectory = relative(directory, path);
  return (
    pathFromDirectory === '' ||
    (!pathFromDirectory.startsWith('..') && !isAbsolute(pathFromDirectory))
  );
};

const createProspectiveFileSystemEntries =
  (candidatePaths: readonly string[]): ((path: string) => FileSystemEntries) =>
  (path) => {
    const directory = resolve(path);
    const directories = new Set<string>();
    const files = new Set<string>();

    for (const candidatePath of candidatePaths) {
      const pathFromDirectory = relative(directory, candidatePath);
      if (
        pathFromDirectory === '' ||
        pathFromDirectory.startsWith('..') ||
        isAbsolute(pathFromDirectory)
      ) {
        continue;
      }
      const [entry, ...remaining] = pathFromDirectory.split(/[\\/]/u);
      if (entry === undefined) {
        continue;
      }
      if (remaining.length === 0) {
        files.add(entry);
      } else {
        directories.add(entry);
      }
    }

    return { directories: [...directories], files: [...files] };
  };

interface TypeScriptCoverageContext {
  readonly candidatePaths: ReadonlyMap<SurfaceEntryRoot, string>;
  readonly cwd: string;
  readonly incompatibilities: Map<
    SurfaceEntryRoot,
    TypeScriptSyntaxIncompatibility[]
  >;
  readonly matcher: MatchTypeScriptFiles;
  readonly prospectiveEntries: (path: string) => FileSystemEntries;
  readonly projectedPackageTypeModule: boolean;
  readonly supportedEntryRoots: Set<SurfaceEntryRoot>;
  readonly visitedConfigPaths: Set<string>;
}

const generatedSurfaceSyntaxDiagnosticCodes = new Set([1309, 1378]);

const readGeneratedSurfaceSyntaxDiagnostic = (
  candidatePath: string,
  cwd: string,
  options: ts.CompilerOptions,
  projectedPackageTypeModule: boolean
): ts.Diagnostic | undefined => {
  const source = 'export {};\nawait 0;\n';
  const normalizedCandidatePath = normalizeForComparison(candidatePath);
  const projectedPackagePath = normalizeForComparison(
    resolve(cwd, 'package.json')
  );
  const host = ts.createCompilerHost({ ...options, noEmit: true });
  const readSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.fileExists = (path) =>
    (projectedPackageTypeModule &&
      normalizeForComparison(path) === projectedPackagePath) ||
    normalizeForComparison(path) === normalizedCandidatePath ||
    fileExists(path);
  host.readFile = (path) => {
    const normalizedPath = normalizeForComparison(path);
    if (projectedPackageTypeModule && normalizedPath === projectedPackagePath) {
      return '{"type":"module"}\n';
    }
    return normalizedPath === normalizedCandidatePath ? source : readFile(path);
  };
  host.getSourceFile = (path, languageVersion, onError, shouldCreate) =>
    normalizeForComparison(path) === normalizedCandidatePath
      ? ts.createSourceFile(path, source, languageVersion, true)
      : readSourceFile(path, languageVersion, onError, shouldCreate);
  const program = ts.createProgram({
    host,
    options: { ...options, noEmit: true },
    rootNames: [candidatePath],
  });
  return ts
    .getPreEmitDiagnostics(program)
    .find((diagnostic) =>
      generatedSurfaceSyntaxDiagnosticCodes.has(diagnostic.code)
    );
};

const collectTypeScriptConfigCoverage = (
  configPath: string,
  context: TypeScriptCoverageContext
): Result<string | null, Error> => {
  const normalizedConfigPath = normalizeForComparison(configPath);
  if (context.visitedConfigPaths.has(normalizedConfigPath)) {
    return Result.ok(null);
  }
  context.visitedConfigPaths.add(normalizedConfigPath);

  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    return Result.err(
      new ValidationError(
        `Unable to read TypeScript config before choosing a surface entry root: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`,
        { context: { configPath } }
      )
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    {
      ...ts.sys,
      readDirectory: (rootDir, extensions, excludes, includes, depth) => [
        ...ts.sys.readDirectory(rootDir, extensions, excludes, includes, depth),
        ...context.matcher(
          rootDir,
          extensions,
          excludes,
          includes,
          ts.sys.useCaseSensitiveFileNames,
          context.cwd,
          depth,
          context.prospectiveEntries,
          resolve
        ),
      ],
    },
    dirname(configPath),
    undefined,
    configPath
  );
  const [error] = parsed.errors;
  if (error !== undefined) {
    return Result.err(
      new ValidationError(
        `Unable to resolve TypeScript config before choosing a surface entry root: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`,
        { context: { configPath } }
      )
    );
  }

  const rootDir = parsed.options.rootDir ?? null;
  const configuredFiles = new Set(parsed.fileNames.map(normalizeForComparison));
  for (const [entryRoot, candidatePath] of context.candidatePaths) {
    if (
      configuredFiles.has(normalizeForComparison(candidatePath)) &&
      (rootDir === null || isWithinDirectory(rootDir, candidatePath))
    ) {
      context.supportedEntryRoots.add(entryRoot);
      const diagnostic = readGeneratedSurfaceSyntaxDiagnostic(
        candidatePath,
        context.cwd,
        parsed.options,
        context.projectedPackageTypeModule
      );
      if (diagnostic !== undefined) {
        const incompatibilities =
          context.incompatibilities.get(entryRoot) ?? [];
        incompatibilities.push({
          code: diagnostic.code,
          configPath,
          message: ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            '\n'
          ),
        });
        context.incompatibilities.set(entryRoot, incompatibilities);
      }
    }
  }

  for (const reference of parsed.projectReferences ?? []) {
    const referenced = collectTypeScriptConfigCoverage(
      ts.resolveProjectReferencePath(reference),
      context
    );
    if (referenced.isErr()) {
      return referenced;
    }
  }

  return Result.ok(rootDir);
};

const readConfiguredTypeScriptLayout = (
  cwd: string,
  surface: Surface,
  options: SurfaceEntryResolutionOptions = {}
): Result<ConfiguredTypeScriptLayout | null, Error> => {
  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists);
  if (configPath === undefined) {
    return Result.ok(null);
  }
  const matcher = readAuditedTypeScriptMatcher();
  if (matcher.isErr()) {
    return matcher;
  }
  const candidatePaths = new Map<SurfaceEntryRoot, string>([
    ['bin', resolve(cwd, getEntryFile(surface, 'bin'))],
    ['src', resolve(cwd, getEntryFile(surface, 'src'))],
  ]);
  const prospectiveEntries = createProspectiveFileSystemEntries([
    ...candidatePaths.values(),
  ]);
  const supportedEntryRoots = new Set<SurfaceEntryRoot>();
  const incompatibilities = new Map<
    SurfaceEntryRoot,
    TypeScriptSyntaxIncompatibility[]
  >();
  const coverage = collectTypeScriptConfigCoverage(configPath, {
    candidatePaths,
    cwd,
    incompatibilities,
    matcher: matcher.value,
    projectedPackageTypeModule: options.projectedPackageTypeModule === true,
    prospectiveEntries,
    supportedEntryRoots,
    visitedConfigPaths: new Set(),
  });
  if (coverage.isErr()) {
    return coverage;
  }

  return Result.ok({
    incompatibilities,
    rootDir: coverage.value,
    supportedEntryRoots,
  });
};

const readCanonicalLintEntryRoots = (
  cwd: string
): Result<ReadonlySet<SurfaceEntryRoot> | null, Error> => {
  const packagePath = resolveProjectPath(cwd, 'package.json');
  if (packagePath.isErr()) {
    return packagePath;
  }
  if (!existsSync(packagePath.value)) {
    return Result.ok(null);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packagePath.value, 'utf8'));
  } catch (error) {
    return Result.err(
      new ValidationError(
        'Unable to read package.json before choosing a surface entry root.',
        {
          cause: error instanceof Error ? error : new Error(String(error)),
          context: { path: packagePath.value },
        }
      )
    );
  }
  if (!isPlainObject(parsed)) {
    return Result.ok(null);
  }
  const { scripts } = parsed;
  if (!isPlainObject(scripts)) {
    return Result.ok(null);
  }
  const { lint } = scripts;
  return Result.ok(
    typeof lint === 'string'
      ? (canonicalLintEntryRoots.get(lint) ?? null)
      : null
  );
};

const resolveConfiguredSurfaceEntryRoot = (
  cwd: string,
  surface: Surface,
  options: SurfaceEntryResolutionOptions
): Result<SurfaceEntryRoot, Error> => {
  const lintEntryRoots = readCanonicalLintEntryRoots(cwd);
  if (lintEntryRoots.isErr()) {
    return lintEntryRoots;
  }
  const configuredLayout = readConfiguredTypeScriptLayout(
    cwd,
    surface,
    options
  );
  if (configuredLayout.isErr()) {
    return configuredLayout;
  }
  const supportedEntryRoots = new Set(
    surfaceEntryRoots.filter(
      (entryRoot) =>
        (configuredLayout.value === null ||
          (configuredLayout.value.supportedEntryRoots.has(entryRoot) &&
            !configuredLayout.value.incompatibilities.has(entryRoot))) &&
        (lintEntryRoots.value === null || lintEntryRoots.value.has(entryRoot))
    )
  );
  for (const entryRoot of surfaceEntryRoots) {
    if (supportedEntryRoots.has(entryRoot)) {
      return Result.ok(entryRoot);
    }
  }
  const hasLintConstraint = lintEntryRoots.value !== null;
  const hasIncompatibleTypeScriptEntry =
    configuredLayout.value !== null &&
    configuredLayout.value.incompatibilities.size > 0;
  let message = `TypeScript config does not include a supported ${surface} surface entry path.`;
  if (hasLintConstraint) {
    message = `TypeScript and lint configuration do not share a supported ${surface} surface entry path.`;
  }
  if (hasIncompatibleTypeScriptEntry) {
    message = `TypeScript config covering the generated ${surface} surface entry cannot compile top-level await.`;
  }
  return Result.err(
    new ValidationError(message, {
      context: {
        candidates: surfaceEntryRoots.map((entryRoot) =>
          getEntryFile(surface, entryRoot)
        ),
        lintEntryRoots:
          lintEntryRoots.value === null ? null : [...lintEntryRoots.value],
        rootDir: configuredLayout.value?.rootDir ?? null,
        ...(hasIncompatibleTypeScriptEntry
          ? {
              incompatibilities: Object.fromEntries(
                configuredLayout.value.incompatibilities
              ),
              reason: 'typescript-surface-syntax-incompatible',
            }
          : {}),
      },
    })
  );
};

/** Preserve an established legacy src layout while fresh scaffolds use bin. */
const resolveSurfaceEntryRoot = (
  cwd: string,
  surface: Surface,
  options: SurfaceEntryResolutionOptions = {}
): Result<SurfaceEntryRoot, Error> => {
  for (const entryRoot of surfaceEntryRoots) {
    const targetExists = projectPathExists(
      cwd,
      getEntryFile(surface, entryRoot)
    );
    if (targetExists.isErr()) {
      return targetExists;
    }
    if (targetExists.value) {
      return Result.ok(entryRoot);
    }
  }

  let hasBinEntry = false;
  let hasSrcEntry = false;
  for (const candidate of Object.keys(surfaceEntryNames) as Surface[]) {
    for (const entryRoot of surfaceEntryRoots) {
      const exists = projectPathExists(cwd, getEntryFile(candidate, entryRoot));
      if (exists.isErr()) {
        return exists;
      }
      if (exists.value) {
        if (entryRoot === 'bin') {
          hasBinEntry = true;
        } else {
          hasSrcEntry = true;
        }
      }
    }
  }
  if (hasSrcEntry && !hasBinEntry) {
    return Result.ok('src');
  }
  if (hasBinEntry) {
    return Result.ok('bin');
  }
  if (options.projectedLocalTsconfig === true) {
    const lintEntryRoots = readCanonicalLintEntryRoots(cwd);
    if (lintEntryRoots.isErr()) {
      return lintEntryRoots;
    }
    for (const entryRoot of surfaceEntryRoots) {
      if (
        lintEntryRoots.value === null ||
        lintEntryRoots.value.has(entryRoot)
      ) {
        return Result.ok(entryRoot);
      }
    }
  }
  return resolveConfiguredSurfaceEntryRoot(cwd, surface, options);
};

/** Resolve the surface entry path without mutating the project. */
export const resolveSurfaceEntryFile = (
  cwd: string,
  surface: Surface,
  options: SurfaceEntryResolutionOptions = {}
): Result<string, Error> => {
  const entryRoot = resolveSurfaceEntryRoot(cwd, surface, options);
  if (entryRoot.isErr()) {
    return entryRoot;
  }
  const entryFile = getEntryFile(surface, entryRoot.value);
  const entryExists = projectPathExists(cwd, entryFile);
  if (entryExists.isErr()) {
    return entryExists;
  }
  if (entryExists.value || options.projectedLocalTsconfig === true) {
    return Result.ok(entryFile);
  }
  const lintEntryRoots = readCanonicalLintEntryRoots(cwd);
  if (lintEntryRoots.isErr()) {
    return lintEntryRoots;
  }
  if (
    lintEntryRoots.value !== null &&
    !lintEntryRoots.value.has(entryRoot.value)
  ) {
    return Result.err(
      new ValidationError(
        `Lint config does not include the established ${entryRoot.value} surface entry path.`,
        {
          context: {
            entryFile,
            lintEntryRoots: [...lintEntryRoots.value],
            reason: 'lint-established-surface-root-excluded',
          },
        }
      )
    );
  }
  const configuredLayout = readConfiguredTypeScriptLayout(
    cwd,
    surface,
    options
  );
  if (configuredLayout.isErr()) {
    return configuredLayout;
  }
  if (
    configuredLayout.value !== null &&
    !configuredLayout.value.supportedEntryRoots.has(entryRoot.value)
  ) {
    return Result.err(
      new ValidationError(
        `TypeScript config does not include the established ${entryRoot.value} surface entry path.`,
        {
          context: {
            entryFile,
            reason: 'typescript-established-surface-root-excluded',
            rootDir: configuredLayout.value.rootDir,
          },
        }
      )
    );
  }
  if (configuredLayout.value?.incompatibilities.has(entryRoot.value) === true) {
    return Result.err(
      new ValidationError(
        `TypeScript config covering the generated ${surface} surface entry cannot compile top-level await.`,
        {
          context: {
            entryFile,
            incompatibilities: configuredLayout.value.incompatibilities.get(
              entryRoot.value
            ),
            reason: 'typescript-surface-syntax-incompatible',
          },
        }
      )
    );
  }
  return Result.ok(entryFile);
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

const readExistingBinEntries = (
  pkg: Record<string, unknown>,
  packageName: string
): Record<string, unknown> => {
  const { bin } = pkg;
  if (isPlainObject(bin)) {
    return bin;
  }
  return typeof bin === 'string' ? { [packageName]: bin } : {};
};

/** Patch deps and optionally bin in a parsed package.json. */
const patchPkgDeps = (
  pkg: Record<string, unknown>,
  surface: Surface,
  cwd: string,
  entryFile: string
): string => {
  const [depName = ''] = surfaceDependencies[surface];
  const deps = (pkg['dependencies'] ?? {}) as Record<string, string>;
  for (const dependency of surfaceDependencies[surface]) {
    deps[dependency] = ontrailsPackageRange;
  }
  if (surface === 'cli') {
    const packageName =
      typeof pkg['name'] === 'string' ? pkg['name'] : basename(cwd);
    pkg['bin'] = {
      ...readExistingBinEntries(pkg, packageName),
      [packageName]: `./${entryFile}`,
    };
  }
  pkg['dependencies'] = Object.fromEntries(
    Object.entries(deps).toSorted(([a], [b]) => a.localeCompare(b))
  );
  return depName;
};

/** Update package.json with surface dependency and CLI bin if needed. */
const updatePkgJsonForSurface = async (
  cwd: string,
  surface: Surface,
  entryFile: string
): Promise<Result<string, Error>> => {
  const pkgPathResult = resolveProjectPath(cwd, 'package.json');
  if (pkgPathResult.isErr()) {
    return pkgPathResult;
  }

  const pkgPath = pkgPathResult.value;
  if (!existsSync(pkgPath)) {
    return Result.ok(surfaceDependencies[surface][0] ?? '');
  }
  const pkg = (await Bun.file(pkgPath).json()) as Record<string, unknown>;
  const depName = patchPkgDeps(pkg, surface, cwd, entryFile);
  const written = await writeProjectFile(
    cwd,
    'package.json',
    stringifyScaffoldPackageJson(pkg)
  );
  return written.isErr() ? Result.err(written.error) : Result.ok(depName);
};

/** Create the entry file for a surface and return the relative path. */
const writeSurfaceEntry = async (
  cwd: string,
  surface: Surface,
  entryFile: string
): Promise<Result<string, Error>> => {
  const entryRoot: SurfaceEntryRoot = entryFile.startsWith('src/')
    ? 'src'
    : 'bin';
  const sourceImport = (await findTopoPath(cwd)) ?? './app.js';
  const appImport =
    entryRoot === 'src' ? sourceImport : `../src/${sourceImport.slice(2)}`;
  const generators = {
    cli: generateCliEntry,
    http: generateHttpEntry,
    mcp: generateMcpEntry,
  } satisfies Record<Surface, (appImportPath: string) => string>;
  const content = generators[surface](appImport);

  const written = await writeProjectFile(cwd, entryFile, content);
  return written.isErr() ? Result.err(written.error) : Result.ok(entryFile);
};

export const addSurface = trail('add.surface', {
  description: 'Add a surface to an existing project',
  implementation: async (input) => {
    const cwd = resolve(input.dir ?? '.');
    const { surface } = input;
    const entryFile = resolveSurfaceEntryFile(cwd, surface);
    if (entryFile.isErr()) {
      return entryFile;
    }
    const entryExists = projectPathExists(cwd, entryFile.value);
    if (entryExists.isErr()) {
      return entryExists;
    }

    let created: string | null = null;
    if (!entryExists.value) {
      const written = await writeSurfaceEntry(cwd, surface, entryFile.value);
      if (written.isErr()) {
        return written;
      }
      created = entryFile.value;
    }

    const dependency = await updatePkgJsonForSurface(
      cwd,
      surface,
      entryFile.value
    );
    if (dependency.isErr()) {
      return dependency;
    }

    return Result.ok({
      created,
      dependency: dependency.value,
    });
  },
  input: z.object({
    dir: z.string().optional().describe('Project directory'),
    surface: z.enum(['cli', 'http', 'mcp']).describe('Surface to add'),
  }),
  output: z.object({
    created: z.string().nullable(),
    dependency: z.string(),
  }),
  permit: { scopes: ['project:write'] },
});
