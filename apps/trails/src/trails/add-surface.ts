/**
 * `add.surface` trail -- Add a surface to an existing project.
 *
 * Generates surface entry points and updates package.json dependencies.
 */

import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { Result, trail, ValidationError } from '@ontrails/core';
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

const surfaceDependencies = {
  cli: ['@ontrails/cli', '@ontrails/commander', '@ontrails/adapter-kit'],
  http: ['@ontrails/hono', '@ontrails/http'],
  mcp: ['@ontrails/mcp', '@ontrails/adapter-kit'],
} satisfies Record<Surface, readonly string[]>;

/** Resolve the entry file for a surface. */
const getEntryFile = (surface: Surface, entryRoot: SurfaceEntryRoot): string =>
  `${entryRoot}/${surfaceEntryNames[surface]}`;

interface ConfiguredTypeScriptLayout {
  readonly rootDir: string | null;
  readonly supportedEntryRoots: ReadonlySet<SurfaceEntryRoot>;
}

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

const readConfiguredTypeScriptLayout = (
  cwd: string,
  surface: Surface
): Result<ConfiguredTypeScriptLayout | null, Error> => {
  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists);
  if (configPath === undefined) {
    return Result.ok(null);
  }
  const matcher = readAuditedTypeScriptMatcher();
  if (matcher.isErr()) {
    return matcher;
  }
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    return Result.err(
      new ValidationError(
        `Unable to read TypeScript config before choosing a surface entry root: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`,
        { context: { configPath } }
      )
    );
  }
  const candidatePaths = new Map<SurfaceEntryRoot, string>([
    ['bin', resolve(cwd, getEntryFile(surface, 'bin'))],
    ['src', resolve(cwd, getEntryFile(surface, 'src'))],
  ]);
  const prospectiveEntries = createProspectiveFileSystemEntries([
    ...candidatePaths.values(),
  ]);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    {
      ...ts.sys,
      readDirectory: (rootDir, extensions, excludes, includes, depth) => [
        ...ts.sys.readDirectory(rootDir, extensions, excludes, includes, depth),
        ...matcher.value(
          rootDir,
          extensions,
          excludes,
          includes,
          ts.sys.useCaseSensitiveFileNames,
          cwd,
          depth,
          prospectiveEntries,
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
  const supportedEntryRoots = new Set<SurfaceEntryRoot>();
  for (const [entryRoot, candidatePath] of candidatePaths) {
    if (
      configuredFiles.has(normalizeForComparison(candidatePath)) &&
      (rootDir === null || isWithinDirectory(rootDir, candidatePath))
    ) {
      supportedEntryRoots.add(entryRoot);
    }
  }

  return Result.ok({ rootDir, supportedEntryRoots });
};

/** Preserve an established legacy src layout while fresh scaffolds use bin. */
const resolveSurfaceEntryRoot = (
  cwd: string,
  surface: Surface
): Result<SurfaceEntryRoot, Error> => {
  const targetRoots: SurfaceEntryRoot[] = ['bin', 'src'];
  for (const entryRoot of targetRoots) {
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
    for (const entryRoot of targetRoots) {
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

  const configuredLayout = readConfiguredTypeScriptLayout(cwd, surface);
  if (configuredLayout.isErr()) {
    return configuredLayout;
  }
  if (configuredLayout.value === null) {
    return Result.ok('bin');
  }
  if (configuredLayout.value.supportedEntryRoots.has('bin')) {
    return Result.ok('bin');
  }
  if (configuredLayout.value.supportedEntryRoots.has('src')) {
    return Result.ok('src');
  }
  return Result.err(
    new ValidationError(
      `TypeScript config does not include a supported ${surface} surface entry path.`,
      {
        context: {
          candidates: [
            getEntryFile(surface, 'bin'),
            getEntryFile(surface, 'src'),
          ],
          rootDir: configuredLayout.value.rootDir,
        },
      }
    )
  );
};

/** Resolve the surface entry path without mutating the project. */
export const resolveSurfaceEntryFile = (
  cwd: string,
  surface: Surface
): Result<string, Error> => {
  const entryRoot = resolveSurfaceEntryRoot(cwd, surface);
  return entryRoot.isErr()
    ? entryRoot
    : Result.ok(getEntryFile(surface, entryRoot.value));
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

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
    pkg['bin'] = {
      [(pkg['name'] as string | undefined) ?? basename(cwd)]: `./${entryFile}`,
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
