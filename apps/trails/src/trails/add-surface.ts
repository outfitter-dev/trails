/**
 * `add.surface` trail -- Add a surface to an existing project.
 *
 * Generates surface entry points and updates package.json dependencies.
 */

import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { AlreadyExistsError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  projectPathExists,
  resolveProjectPath,
  writeProjectFile,
} from '../project-writes.js';
import {
  ontrailsPackageRange,
  scaffoldDependencyVersions,
} from '../versions.js';
import { findTopoPath } from './project.js';

type Surface = 'cli' | 'http' | 'mcp';

const generateCliEntry = (appImportPath: string): string =>
  `import { surface } from '@ontrails/cli/commander';

import { app } from '${appImportPath}';

await surface(app);
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

const surfaceEntryFiles = {
  cli: 'src/cli.ts',
  http: 'src/http.ts',
  mcp: 'src/mcp.ts',
} satisfies Record<Surface, string>;

const surfaceDependencies = {
  cli: ['@ontrails/cli'],
  http: ['@ontrails/hono', '@ontrails/http'],
  mcp: ['@ontrails/mcp'],
} satisfies Record<Surface, readonly string[]>;

/** Resolve the entry file for a surface. */
const getEntryFile = (surface: Surface): string => surfaceEntryFiles[surface];

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

/** Patch deps and optionally bin in a parsed package.json. */
const patchPkgDeps = (
  pkg: Record<string, unknown>,
  surface: Surface,
  cwd: string
): string => {
  const [depName = ''] = surfaceDependencies[surface];
  const deps = (pkg['dependencies'] ?? {}) as Record<string, string>;
  for (const dependency of surfaceDependencies[surface]) {
    deps[dependency] = ontrailsPackageRange;
  }
  if (surface === 'cli') {
    deps['commander'] = scaffoldDependencyVersions.commander;
    pkg['bin'] = {
      [(pkg['name'] as string | undefined) ?? basename(cwd)]: './src/cli.ts',
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
  surface: Surface
): Promise<Result<string, Error>> => {
  const pkgPathResult = resolveProjectPath(cwd, 'package.json');
  if (pkgPathResult.isErr()) {
    return Result.err(pkgPathResult.error);
  }

  const pkgPath = pkgPathResult.value;
  if (!existsSync(pkgPath)) {
    return Result.ok(surfaceDependencies[surface][0] ?? '');
  }
  const pkg = (await Bun.file(pkgPath).json()) as Record<string, unknown>;
  const depName = patchPkgDeps(pkg, surface, cwd);
  const written = await writeProjectFile(
    cwd,
    'package.json',
    `${JSON.stringify(pkg, null, 2)}\n`
  );
  return written.isErr() ? Result.err(written.error) : Result.ok(depName);
};

/** Create the entry file for a surface and return the relative path. */
const writeSurfaceEntry = async (
  cwd: string,
  surface: Surface
): Promise<Result<string, Error>> => {
  const entryFile = getEntryFile(surface);
  const appImport = (await findTopoPath(cwd)) ?? './app.js';
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
  blaze: async (input) => {
    const cwd = resolve(input.dir ?? '.');
    const { surface } = input;
    const entryFile = getEntryFile(surface);
    const entryExists = projectPathExists(cwd, entryFile);
    if (entryExists.isErr()) {
      return Result.err(entryExists.error);
    }

    if (entryExists.value) {
      return Result.err(
        new AlreadyExistsError(
          `${surface.toUpperCase()} surface already exists. Nothing to do.`
        )
      );
    }

    const created = await writeSurfaceEntry(cwd, surface);
    if (created.isErr()) {
      return Result.err(created.error);
    }

    const dependency = await updatePkgJsonForSurface(cwd, surface);
    if (dependency.isErr()) {
      return Result.err(dependency.error);
    }

    return Result.ok({
      created: created.value,
      dependency: dependency.value,
    });
  },
  description: 'Add a surface to an existing project',
  input: z.object({
    dir: z.string().optional().describe('Project directory'),
    surface: z.enum(['cli', 'http', 'mcp']).describe('Surface to add'),
  }),
  output: z.object({
    created: z.string(),
    dependency: z.string(),
  }),
});
