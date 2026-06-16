/**
 * `release.check` trail -- Branch-local release rule evaluation.
 */

import { Result, trail, ValidationError } from '@ontrails/core';
import { z } from 'zod';

import { runReleaseCheck } from '../release/check.js';
import { resolveTrailRootDir } from './root-dir.js';

const releaseCheckInputSchema = z.object({
  baseRef: z
    .string()
    .optional()
    .describe('Base git ref for changed-file and contract fact comparison'),
  changedFiles: z
    .string()
    .optional()
    .describe('Path to a newline-delimited changed-file list'),
  configPath: z.string().optional().describe('Path to trails.config.ts'),
  releaseNone: z
    .boolean()
    .default(false)
    .describe('Compatibility no-release override'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

const contractReleaseFactAspectSchema = z.enum([
  'input',
  'output',
  'surfaces',
  'trail',
  'visibility',
]);

const contractReleaseFactSchema = z.object({
  aspect: contractReleaseFactAspectSchema,
  baseHash: z.string().nullable(),
  changedFiles: z.array(z.string()).readonly(),
  currentHash: z.string().nullable(),
  packageName: z.string().optional(),
  path: z.string(),
  trailId: z.string(),
  workspacePath: z.string().optional(),
});

const releaseCheckOutputSchema = z.object({
  activePackageChangesetsWithoutReleaseFacts: z.array(z.string()).readonly(),
  affectedPackages: z.array(z.string()).readonly(),
  changedChangesets: z.array(z.string()).readonly(),
  configPath: z.string().optional(),
  contractFacts: z.array(contractReleaseFactSchema).readonly(),
  coveredPackages: z.array(z.string()).readonly(),
  errors: z.array(z.string()).readonly(),
  formatted: z.string(),
  matchedRuleIds: z.array(z.string()).readonly(),
  noReleaseOverride: z.boolean(),
  passed: z.boolean(),
  releaseNone: z.boolean(),
  uncoveredContractFacts: z.array(contractReleaseFactSchema).readonly(),
  versionRelease: z.boolean(),
});

export const releaseCheckTrail = trail('release.check', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }

    try {
      return Result.ok(
        await runReleaseCheck({
          ...(input.baseRef === undefined ? {} : { baseRef: input.baseRef }),
          ...(input.changedFiles === undefined
            ? {}
            : { changedFilesPath: input.changedFiles }),
          ...(input.configPath === undefined
            ? {}
            : { configPath: input.configPath }),
          env: ctx.env ?? {},
          releaseNone: input.releaseNone,
          repoRoot: rootDirResult.value,
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
  description: 'Check branch-local release rules',
  examples: [
    {
      input: { baseRef: 'HEAD' },
      name: 'Check release rules from the current HEAD',
    },
  ],
  input: releaseCheckInputSchema,
  intent: 'read',
  output: releaseCheckOutputSchema,
  permit: 'public',
});
