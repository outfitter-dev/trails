/**
 * `warden` trail -- Governance checks.
 *
 * Thin wrapper around `runWarden` and `formatWardenReport` from @ontrails/warden.
 */

import { Result, trail } from '@ontrails/core';
import {
  formatGitHubAnnotations,
  formatJson,
  formatSummary,
  formatWardenReport,
  runWarden,
} from '@ontrails/warden';
import { z } from 'zod';

import { loadApp } from './load-app.js';

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const wardenTrail = trail('warden', {
  description: 'Run governance checks (lint + drift)',
  examples: [
    {
      input: {
        driftOnly: false,
        lintOnly: false,
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
  implementation: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    // oxlint-disable-next-line prefer-await-to-then -- catch converts rejection to undefined cleanly
    const topo = await loadApp('./src/app.ts', rootDir).catch(
      (): undefined => undefined
    );

    const report = await runWarden({
      driftOnly: input.driftOnly,
      lintOnly: input.lintOnly,
      rootDir,
      topo,
    });

    const formatters: Record<string, (r: typeof report) => string> = {
      github: formatGitHubAnnotations,
      json: formatJson,
      summary: formatSummary,
      text: formatWardenReport,
    };
    const formatter = formatters[input.format] ?? formatWardenReport;
    const formatted = formatter(report);

    return Result.ok({
      diagnostics: report.diagnostics,
      drift: report.drift,
      errorCount: report.errorCount,
      formatted,
      passed: report.passed,
      warnCount: report.warnCount,
    });
  },
  input: z.object({
    driftOnly: z.boolean().default(false).describe('Only run drift detection'),
    format: z
      .enum(['text', 'json', 'github', 'summary'])
      .default('text')
      .describe('Output format: text, json, github, or summary'),
    lintOnly: z.boolean().default(false).describe('Only run lint rules'),
    rootDir: z.string().optional().describe('Root directory to scan'),
  }),
  output: z.object({
    diagnostics: z.array(
      z.object({
        filePath: z.string(),
        line: z.number(),
        message: z.string(),
        rule: z.string(),
        severity: z.enum(['error', 'warn']),
      })
    ),
    drift: z
      .object({
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
  readOnly: true,
});
