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
import type { CiFailOn } from '../src/governance.js';
import { runCiGovernance } from '../src/governance.js';

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
const failOn = values['fail-on'] as CiFailOn;
const rootDir = resolve(values['root-dir'] ?? process.cwd());

const result = await runCiGovernance({ failOn, format, rootDir });

// Write output to stdout
console.log(result.output);

// Write markdown summary to GitHub step summary if available
const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
if (summaryPath) {
  await Bun.write(summaryPath, result.summary);
}

process.exit(result.passed ? 0 : 1);
