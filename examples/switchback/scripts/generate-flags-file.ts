/**
 * Regenerate the committed demo flag definitions from src/fixtures.ts so the
 * file-backed store and the mock resource always serve the same data.
 *
 * Usage: bun run scripts/generate-flags-file.ts (from examples/switchback)
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fixtureFlags } from '../src/fixtures.js';

const sorted = fixtureFlags().toSorted((a, b) => a.key.localeCompare(b.key));
const target = join(import.meta.dir, '..', 'switchback.flags.json');
writeFileSync(target, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`wrote ${target}`);
