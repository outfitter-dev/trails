#!/usr/bin/env bun
/* oxlint-disable eslint-plugin-jest/require-hook -- CLI bin entrypoints execute at module scope */

import { runWardenCommand } from '../src/command.js';

const HELP = `Usage: warden [options]

Run Trails Warden governance checks.

Options:
  --ci                         Apply CI defaults
  --pre-push                   Apply pre-push defaults
  --apps, -a <names>           Comma-delimited Trails app names
  --config-path <path>         Path to trails.config.* file
  --root-dir <path>            Project root to inspect
  --fix                        Apply safe source fixes
  --adapter-check              Include shared adapter authoring diagnostics
  --depth <value>              source, project, topo, or all
  --fail-on <value>            error or warning
  --format <value>             summary, github, or json
  --drafts <value>             include, exclude, or only
  --jurisdiction-ignore <glob> Root-relative path glob Warden should not govern
  --lock <value>               auto, cached, refresh, or skip
  --no-lock-mutation           Do not write lock artifacts
  --strict                     Fail on warnings
  -h, --help                   Display help for command
`;

const args = Bun.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
  console.log(HELP);
  process.exit(0);
}

const env = { ...process.env } as Record<string, string | undefined>;
const result = await runWardenCommand({
  args,
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
