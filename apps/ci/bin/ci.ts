#!/usr/bin/env bun
/**
 * CI governance check entrypoint.
 *
 * Runs warden lint and drift detection, outputs results in the requested
 * format, and writes a GitHub step summary when running in Actions.
 */
/* oxlint-disable eslint-plugin-jest/require-hook -- CLI bin entrypoints execute at module scope */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { CiFormat } from '../src/formatters.js';
import { formatCiOutput } from '../src/formatters.js';
import { runWarden } from '@ontrails/warden';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    'fail-on': { default: 'error', type: 'string' },
    format: { default: 'auto', type: 'string' },
    'root-dir': { default: process.cwd(), type: 'string' },
  },
  strict: true,
});

const isGitHub = process.env['GITHUB_ACTIONS'] === 'true';
const autoFormat: CiFormat = isGitHub ? 'github' : 'json';
const format: CiFormat =
  values.format === 'auto' ? autoFormat : (values.format as CiFormat);
const failOn = values['fail-on'] as 'error' | 'warning';
const rootDir = resolve(values['root-dir'] ?? process.cwd());

const report = await runWarden({ rootDir });
const driftResult = report.drift ?? {
  committedHash: null,
  currentHash: 'unknown',
  stale: false,
};

const output = formatCiOutput(format, { driftResult, wardenReport: report });

// Write output to stdout
console.log(output);

// Write markdown summary to GitHub step summary if available
const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
if (summaryPath) {
  const summary = formatCiOutput('summary', {
    driftResult,
    wardenReport: report,
  });
  await Bun.write(summaryPath, summary);
}

// Determine exit code
const failedByErrors = report.errorCount > 0;
const failedByWarnings = failOn === 'warning' && report.warnCount > 0;
const hasDrift = driftResult.stale;
const passed = !failedByErrors && !failedByWarnings && !hasDrift;

process.exit(passed ? 0 : 1);
