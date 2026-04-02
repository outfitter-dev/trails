/**
 * `add.surface` trail -- Add a surface to an existing project.
 *
 * Generates the CLI or MCP entry point and updates package.json dependencies.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { findTopoPath } from './project.js';

const generateCliEntry = (appImportPath: string): string =>
  `import { trailhead } from '@ontrails/cli/commander';

import { app } from '${appImportPath}';

trailhead(app);
`;

const generateMcpEntry = (appImportPath: string): string =>
  `import { trailhead } from '@ontrails/mcp';

import { app } from '${appImportPath}';

await trailhead(app);
`;

/** Resolve the entry file for a surface. */
const getEntryFile = (surface: 'cli' | 'mcp'): string =>
  surface === 'cli' ? 'src/cli.ts' : 'src/mcp.ts';

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

/** Patch deps and optionally bin in a parsed package.json. */
const patchPkgDeps = (
  pkg: Record<string, unknown>,
  surface: 'cli' | 'mcp',
  cwd: string
): string => {
  const depName = surface === 'cli' ? '@ontrails/cli' : '@ontrails/mcp';
  const deps = (pkg['dependencies'] ?? {}) as Record<string, string>;
  deps[depName] = 'workspace:*';
  if (surface === 'cli') {
    deps['commander'] = '^14.0.0';
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
  surface: 'cli' | 'mcp'
): Promise<string> => {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    return surface === 'cli' ? '@ontrails/cli' : '@ontrails/mcp';
  }
  const pkg = (await Bun.file(pkgPath).json()) as Record<string, unknown>;
  const depName = patchPkgDeps(pkg, surface, cwd);
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return depName;
};

/** Create the entry file for a surface and return the relative path. */
const writeSurfaceEntry = async (
  cwd: string,
  surface: 'cli' | 'mcp'
): Promise<string> => {
  const entryFile = getEntryFile(surface);
  const fullEntryPath = join(cwd, entryFile);
  const appImport = (await findTopoPath(cwd)) ?? './app.js';
  const content =
    surface === 'cli'
      ? generateCliEntry(appImport)
      : generateMcpEntry(appImport);

  mkdirSync(dirname(fullEntryPath), { recursive: true });
  await Bun.write(fullEntryPath, content);
  return entryFile;
};

export const addSurface = trail('add.surface', {
  description: 'Add a surface to an existing project',
  input: z.object({
    dir: z.string().optional().describe('Project directory'),
    surface: z.enum(['cli', 'mcp']).describe('Surface to add'),
  }),
  output: z.object({
    created: z.string(),
    dependency: z.string(),
  }),
  run: async (input) => {
    const cwd = resolve(input.dir ?? '.');
    const { surface } = input;
    const entryFile = getEntryFile(surface);

    if (existsSync(join(cwd, entryFile))) {
      return Result.err(
        new Error(
          `${surface.toUpperCase()} trailhead already exists. Nothing to do.`
        )
      );
    }

    return Result.ok({
      created: await writeSurfaceEntry(cwd, surface),
      dependency: await updatePkgJsonForSurface(cwd, surface),
    });
  },
});
