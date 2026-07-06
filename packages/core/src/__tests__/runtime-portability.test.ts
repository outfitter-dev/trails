import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Structural portability gate (TRL-1198): the core barrel must carry no
 * eager `bun:`/`node:` builtin value imports. The Cloudflare adapter's
 * miniflare lane proves the bundled execution path boots under workerd,
 * but Bun's browser-target bundler silently shims `node:` imports to
 * empty objects, so a regressed eager `node:` import would sail through
 * it — this source-level scan is the airtight half of the gate.
 */

const SRC_DIR = new URL('..', import.meta.url).pathname;

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') {
      return [];
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });

// Matches `import ... from 'bun:x'` / `import 'node:x'` value imports and
// `export ... from` re-exports, but not `import type` (erased at runtime).
const EAGER_BUILTIN_IMPORT =
  /^(?:import|export)\s+(?!type\b)[^;]*?from\s+['"](?:bun|node):/m;
const BARE_BUILTIN_IMPORT = /^import\s+['"](?:bun|node):/m;

describe('core barrel runtime portability', () => {
  test('no source module eagerly imports a bun:/node: builtin', () => {
    const offenders = listSourceFiles(SRC_DIR)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return (
          EAGER_BUILTIN_IMPORT.test(source) || BARE_BUILTIN_IMPORT.test(source)
        );
      })
      .map((path) => relative(SRC_DIR, path));

    expect(offenders).toEqual([]);
  });
});
