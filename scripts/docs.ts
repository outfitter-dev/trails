#!/usr/bin/env bun

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { writeDecisionMap } from '../.skillset/plugins/trails-dev/skills/trails-adrs/scripts/lib/decision-map.ts';
import { rebuildIndex } from '../.skillset/plugins/trails-dev/skills/trails-adrs/scripts/lib/index.ts';
import { checkDocumentationMigrations } from './docs/migrations.ts';

const root = resolve(import.meta.dir, '..');
const run = (command: readonly string[]): void => {
  const result = Bun.spawnSync([process.execPath, ...command], {
    cwd: root,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Documentation owner command failed: bun ${command.join(' ')}`
    );
  }
};

const main = (): void => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: process.argv.slice(2),
    options: { 'base-ref': { type: 'string' } },
  });
  if (resolve(process.cwd()) !== root) {
    throw new Error(
      `Run documentation commands from the repository root: ${root}`
    );
  }
  if (
    positionals.length !== 1 ||
    !['check', 'generate'].includes(positionals[0])
  ) {
    throw new Error(
      'Usage: bun scripts/docs.ts generate | check --base-ref <ref-or-SHA>'
    );
  }
  if (positionals[0] === 'generate') {
    if (values['base-ref'] !== undefined) {
      throw new Error(
        '--base-ref belongs to check; generation does not select history.'
      );
    }
    run(['run', 'error-taxonomy:sync']);
    run(['run', 'warden:agents:sync']);
    // The canonical ADR owner produces all four artifacts; this caller derives no ADR facts.
    rebuildIndex();
    writeDecisionMap();
    return;
  }
  const baseRef = values['base-ref'];
  if (!baseRef) {
    throw new Error(
      'docs:check requires --base-ref <ref-or-SHA>; CI pins canonical main, while a local layer base is focused evidence only.'
    );
  }
  const result = checkDocumentationMigrations(root, baseRef);
  console.error(
    `Documentation history: base=${result.base || baseRef} before=${result.before || 'unavailable'} head=${result.head || 'unavailable'}`
  );
  if (result.failures.length > 0) {
    throw new Error(result.failures.join('\n'));
  }
  for (const command of [
    'docs:links',
    'docs:snippets',
    'docs:wrap-check',
    'error-taxonomy:check',
    'warden:agents:check',
  ]) {
    run(['run', command]);
  }
  run(['scripts/adr.ts', 'check']);
  console.error(
    'Documentation migration paths and existing owner checks passed.'
  );
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
