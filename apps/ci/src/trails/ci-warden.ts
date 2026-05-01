/**
 * `ci.warden` trail — runs warden governance checks with CI-friendly output.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import type { CiFormat } from '../formatters.js';
import type { CiFailOn } from '../governance.js';
import { runCiGovernance } from '../governance.js';

import { resolveCiRootDir } from './root-dir.js';

export const ciWardenTrail = trail('ci.warden', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveCiRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return Result.err(rootDirResult.error);
    }
    const rootDir = rootDirResult.value;
    const format: CiFormat = input.format ?? 'json';
    const failOn: CiFailOn = input.failOn ?? 'error';
    const result = await runCiGovernance({ failOn, format, rootDir });

    // Preserve the warden trail's historical `passed` contract: drift
    // status flows through `output` but does not flip the trail's
    // pass/fail flag. The CLI entrypoint still folds drift into its
    // exit code via `runCiGovernance` / `result.passed` directly.
    const failedByErrors = result.errorCount > 0;
    const failedByWarnings = failOn === 'warning' && result.warningCount > 0;
    const passed = !failedByErrors && !failedByWarnings;

    return Result.ok({
      errorCount: result.errorCount,
      output: result.output,
      passed,
      warningCount: result.warningCount,
    });
  },
  description: 'Run warden governance checks with CI-friendly output',
  examples: [
    {
      input: { failOn: 'error', format: 'github' },
      name: 'GitHub Actions format',
    },
    {
      input: { failOn: 'error', format: 'json' },
      name: 'JSON format',
    },
  ],
  input: z.object({
    failOn: z
      .enum(['error', 'warning'])
      .default('error')
      .describe('Minimum severity to fail on'),
    format: z
      .enum(['json', 'github', 'summary'])
      .default('json')
      .describe('Output format'),
    rootDir: z.string().optional().describe('Root directory to scan'),
  }),
  intent: 'read',
  output: z.object({
    errorCount: z.number(),
    output: z.string(),
    passed: z.boolean(),
    warningCount: z.number(),
  }),
});
