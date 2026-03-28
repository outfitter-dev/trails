/**
 * `ci.warden` trail — runs warden governance checks with CI-friendly output.
 */

import { Result, trail } from '@ontrails/core';
import { runWarden } from '@ontrails/warden';
import { z } from 'zod';

import type { CiFormat } from '../formatters.js';
import { formatCiOutput } from '../formatters.js';

export const ciWardenTrail = trail('ci.warden', {
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
  run: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const format: CiFormat = input.format ?? 'json';
    const failOn = input.failOn ?? 'error';

    const report = await runWarden({ rootDir });
    const driftResult = report.drift ?? {
      committedHash: null,
      currentHash: 'unknown',
      stale: false,
    };

    const output = formatCiOutput(format, {
      driftResult,
      wardenReport: report,
    });

    const failedByErrors = report.errorCount > 0;
    const failedByWarnings = failOn === 'warning' && report.warnCount > 0;
    const passed = !failedByErrors && !failedByWarnings;

    return Result.ok({
      errorCount: report.errorCount,
      output,
      passed,
      warningCount: report.warnCount,
    });
  },
});
