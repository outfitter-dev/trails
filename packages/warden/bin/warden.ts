#!/usr/bin/env bun
/* oxlint-disable eslint-plugin-jest/require-hook -- CLI bin entrypoints execute at module scope */

import { runWardenCommand } from '../src/command.js';

const env = { ...process.env } as Record<string, string | undefined>;
const result = await runWardenCommand({
  args: Bun.argv.slice(2),
  cwd: process.cwd(),
  env,
});

if (result.output.length > 0) {
  console.log(result.output);
}

const summaryPath = env['GITHUB_STEP_SUMMARY'];
if (result.writeStepSummary && summaryPath !== undefined) {
  await Bun.write(summaryPath, result.summary);
}

process.exit(result.exitCode);
