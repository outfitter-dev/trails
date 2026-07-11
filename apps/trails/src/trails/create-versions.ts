/**
 * `create.versions` trail -- Sync generated scaffold dependency versions.
 *
 * Derives `apps/trails/src/scaffold-versions.generated.ts` from the root
 * `package.json` catalog and devDependencies. Graduated from
 * `scripts/sync-scaffold-versions.ts`.
 */

import { Result, trail, ValidationError } from '@ontrails/core';
import { z } from 'zod';

import { syncScaffoldVersions } from '../scaffold-version-sync.js';
import { resolveTrailRootDir } from './root-dir.js';

const createVersionsInputSchema = z.object({
  check: z
    .boolean()
    .default(false)
    .describe('Verify the generated file is current instead of writing'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

const createVersionsOutputSchema = z.object({
  generatedPath: z.string(),
  mode: z.enum(['check', 'write']),
  written: z.boolean(),
});

export const createVersionsTrail = trail('create.versions', {
  description: 'Sync generated scaffold dependency versions',
  examples: [
    {
      input: { check: true },
      name: 'Verify generated scaffold versions are current',
    },
  ],
  implementation: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }

    try {
      return Result.ok(
        await syncScaffoldVersions({
          check: input.check,
          rootDir: rootDirResult.value,
        })
      );
    } catch (error) {
      return Result.err(
        new ValidationError(
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  },
  input: createVersionsInputSchema,
  intent: 'write',
  output: createVersionsOutputSchema,
  permit: { scopes: ['project:write'] },
});
