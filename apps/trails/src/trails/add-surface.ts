/**
 * `add.surface` trail -- Add a surface to an existing project.
 *
 * Generates surface entry points and updates package.json dependencies.
 */

import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { Result, trail } from '@ontrails/core';
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

const generateCliEntry = (appImportPath: string): string =>
  `import { devPermitPreset, permitPreset } from '@ontrails/cli';
import { surface } from '@ontrails/commander';

import { app } from '${appImportPath}';

await surface(app, {
  presets: [permitPreset(), devPermitPreset()],
});
`;

const generateMcpEntry = (appImportPath: string): string =>
  `import { surface } from '@ontrails/mcp';

import { app } from '${appImportPath}';

await surface(app);
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
  cli: ['@ontrails/cli', '@ontrails/commander'],
  http: ['@ontrails/hono', '@ontrails/http'],
  mcp: ['@ontrails/mcp'],
} satisfies Record<Surface, readonly string[]>;

/** Resolve the entry file for a surface. */
const getEntryFile = (surface: Surface, entryRoot: SurfaceEntryRoot): string =>
  `${entryRoot}/${surfaceEntryNames[surface]}`;

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
  return Result.ok(hasSrcEntry && !hasBinEntry ? 'src' : 'bin');
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
