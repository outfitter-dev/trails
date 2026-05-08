/**
 * `warden` trail -- Governance checks.
 *
 * Thin wrapper around the shared @ontrails/warden command surface.
 */

import { Result, trail } from '@ontrails/core';
import {
  runWardenCommand,
  wardenDepthValues,
  wardenDraftsValues,
  wardenFailOnValues,
  wardenFormatValues,
  wardenLockValues,
} from '@ontrails/warden';
import { z } from 'zod';

import { resolveTrailRootDir } from './root-dir.js';

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

const wardenInputSchema = z.object({
  apps: z
    .array(z.string())
    .optional()
    .describe('App names or module paths to govern'),
  cached: z.boolean().default(false).describe('Alias for --lock cached'),
  ci: z.boolean().default(false).describe('Use the CI Warden preset'),
  configPath: z.string().optional().describe('Path to trails.config.ts'),
  depth: z
    .enum(wardenDepthValues)
    .optional()
    .describe('Cumulative analysis depth'),
  drafts: z.enum(wardenDraftsValues).optional().describe('Draft state mode'),
  excludeDrafts: z
    .boolean()
    .default(false)
    .describe('Alias for --drafts exclude'),
  failOn: z.enum(wardenFailOnValues).optional().describe('Failure threshold'),
  format: z.enum(wardenFormatValues).optional().describe('Output format'),
  github: z.boolean().default(false).describe('Alias for --format github'),
  includeDrafts: z
    .boolean()
    .default(false)
    .describe('Alias for --drafts include'),
  json: z.boolean().default(false).describe('Alias for --format json'),
  lock: z.enum(wardenLockValues).optional().describe('Lockfile mode'),
  noLockMutation: z
    .boolean()
    .default(false)
    .describe('Suppress lockfile mutation'),
  onlyDrafts: z.boolean().default(false).describe('Alias for --drafts only'),
  prePush: z.boolean().default(false).describe('Use the pre-push preset'),
  refresh: z.boolean().default(false).describe('Alias for --lock refresh'),
  rootDir: z.string().optional().describe('Root directory to scan'),
  skipLock: z.boolean().default(false).describe('Alias for --lock skip'),
  strict: z.boolean().default(false).describe('Alias for --fail-on warning'),
  summary: z.boolean().default(false).describe('Alias for --format summary'),
});

type WardenTrailInput = z.infer<typeof wardenInputSchema>;

const pushFlag = (args: string[], condition: boolean, flag: string): void => {
  if (condition) {
    args.push(flag);
  }
};

const pushValue = (
  args: string[],
  flag: string,
  value: string | undefined
): void => {
  if (value !== undefined) {
    args.push(flag, value);
  }
};

const pushApps = (
  args: string[],
  apps: readonly string[] | undefined
): void => {
  if (apps !== undefined && apps.length > 0) {
    args.push('--apps', apps.join(','));
  }
};

export const buildWardenCommandArgs = (
  input: WardenTrailInput
): readonly string[] => {
  const args: string[] = [];

  pushFlag(args, input.prePush, '--pre-push');
  pushFlag(args, input.ci, '--ci');
  pushValue(args, '--depth', input.depth);
  if (input.strict) {
    args.push('--strict');
  } else {
    pushValue(args, '--fail-on', input.failOn);
  }
  if (input.github) {
    args.push('--github');
  } else if (input.json) {
    args.push('--json');
  } else if (input.summary) {
    args.push('--summary');
  } else {
    pushValue(args, '--format', input.format);
  }
  if (input.skipLock) {
    args.push('--skip-lock');
  } else if (input.refresh) {
    args.push('--refresh');
  } else if (input.cached) {
    args.push('--cached');
  } else {
    pushValue(args, '--lock', input.lock);
  }
  if (input.onlyDrafts) {
    args.push('--only-drafts');
  } else if (input.excludeDrafts) {
    args.push('--exclude-drafts');
  } else if (input.includeDrafts) {
    args.push('--include-drafts');
  } else {
    pushValue(args, '--drafts', input.drafts);
  }
  pushFlag(args, input.noLockMutation, '--no-lock-mutation');
  pushValue(args, '--config-path', input.configPath);
  pushApps(args, input.apps);

  return args;
};

export const wardenTrail = trail('warden', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return Result.err(rootDirResult.error);
    }
    const rootDir = rootDirResult.value;
    const result = await runWardenCommand({
      args: buildWardenCommandArgs(input),
      cwd: rootDir,
      env: ctx.env ?? {},
    });
    const { report } = result;

    return Result.ok({
      diagnostics: [...report.diagnostics],
      drift: report.drift,
      errorCount: report.errorCount,
      formatted: result.output,
      passed: report.passed,
      warnCount: report.warnCount,
    });
  },
  description: 'Run governance checks (lint + drift)',
  examples: [
    {
      input: {
        lock: 'skip',
      },
      name: 'Default warden run',
    },
    {
      input: {
        format: 'github',
      },
      name: 'GitHub Actions annotations',
    },
  ],
  input: wardenInputSchema,
  intent: 'read',
  output: z.object({
    diagnostics: z.array(
      z.object({
        filePath: z.string(),
        line: z.number(),
        message: z.string(),
        rule: z.string(),
        severity: z.enum(['error', 'warn']),
        topoName: z.string().optional(),
      })
    ),
    drift: z
      .object({
        blockedReason: z.string().optional(),
        committedHash: z.string().nullable(),
        currentHash: z.string(),
        stale: z.boolean(),
      })
      .nullable(),
    errorCount: z.number(),
    formatted: z.string(),
    passed: z.boolean(),
    warnCount: z.number(),
  }),
});
