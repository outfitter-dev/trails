/**
 * `add.trailhead` trail -- Add a trailhead to an existing project.
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

/** Resolve the entry file for a trailhead. */
const getEntryFile = (trailhead: 'cli' | 'mcp'): string =>
  trailhead === 'cli' ? 'src/cli.ts' : 'src/mcp.ts';

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

/** Patch deps and optionally bin in a parsed package.json. */
const patchPkgDeps = (
  pkg: Record<string, unknown>,
  trailhead: 'cli' | 'mcp',
  cwd: string
): string => {
  const depName = trailhead === 'cli' ? '@ontrails/cli' : '@ontrails/mcp';
  const deps = (pkg['dependencies'] ?? {}) as Record<string, string>;
  deps[depName] = 'workspace:*';
  if (trailhead === 'cli') {
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

/** Update package.json with trailhead dependency and CLI bin if needed. */
const updatePkgJsonForTrailhead = async (
  cwd: string,
  trailhead: 'cli' | 'mcp'
): Promise<string> => {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    return trailhead === 'cli' ? '@ontrails/cli' : '@ontrails/mcp';
  }
  const pkg = (await Bun.file(pkgPath).json()) as Record<string, unknown>;
  const depName = patchPkgDeps(pkg, trailhead, cwd);
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return depName;
};

/** Create the entry file for a trailhead and return the relative path. */
const writeTrailheadEntry = async (
  cwd: string,
  trailhead: 'cli' | 'mcp'
): Promise<string> => {
  const entryFile = getEntryFile(trailhead);
  const fullEntryPath = join(cwd, entryFile);
  const appImport = (await findTopoPath(cwd)) ?? './app.js';
  const content =
    trailhead === 'cli'
      ? generateCliEntry(appImport)
      : generateMcpEntry(appImport);

  mkdirSync(dirname(fullEntryPath), { recursive: true });
  await Bun.write(fullEntryPath, content);
  return entryFile;
};

export const addTrailhead = trail('add.trailhead', {
  blaze: async (input) => {
    const cwd = resolve(input.dir ?? '.');
    const { trailhead } = input;
    const entryFile = getEntryFile(trailhead);

    if (existsSync(join(cwd, entryFile))) {
      return Result.err(
        new Error(
          `${trailhead.toUpperCase()} trailhead already exists. Nothing to do.`
        )
      );
    }

    return Result.ok({
      created: await writeTrailheadEntry(cwd, trailhead),
      dependency: await updatePkgJsonForTrailhead(cwd, trailhead),
    });
  },
  description: 'Add a trailhead to an existing project',
  input: z.object({
    dir: z.string().optional().describe('Project directory'),
    trailhead: z.enum(['cli', 'mcp']).describe('Trailhead to add'),
  }),
  output: z.object({
    created: z.string(),
    dependency: z.string(),
  }),
});
