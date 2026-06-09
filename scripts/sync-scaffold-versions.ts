#!/usr/bin/env bun
/**
 * Compatibility wrapper. The scaffold-version derivation graduated into the
 * `create.versions` trail (`trails create versions`); this script only
 * forwards to the trails CLI.
 *
 * Usage:
 *   bun scripts/sync-scaffold-versions.ts            # write generated file
 *   bun scripts/sync-scaffold-versions.ts --check    # exit non-zero on drift
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const passthrough = process.argv.includes('--check') ? ['--check'] : [];

const proc = Bun.spawnSync({
  cmd: [
    'bun',
    'apps/trails/bin/trails.ts',
    'create',
    'versions',
    ...passthrough,
    '--permit',
    '{"id":"scaffold-versions-sync","scopes":["project:write"]}',
  ],
  cwd: repoRoot,
  stdio: ['inherit', 'inherit', 'inherit'],
});

process.exit(proc.exitCode ?? 1);
