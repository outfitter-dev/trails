import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../../../..');

/**
 * A production read of the app-module `trailsOverlays` export: a bracket or
 * dot member access on the module-exports record, or a destructuring bind
 * (`const { trailsOverlays } = mod`). Prose mentions (backticked doc
 * references, plain identifiers, static `import {} from` statements)
 * intentionally do not match.
 */
const MODULE_KEY_READ =
  /\[['"]trailsOverlays['"]\]|\.trailsOverlays\b|\{[^}]*\btrailsOverlays\b[^}]*\}\s*=[^=]/;

const isProductionSource = (path: string): boolean =>
  path.endsWith('.ts') &&
  !path.endsWith('.test.ts') &&
  !path.includes('__tests__');

const collectSourceFiles = (dir: string): readonly string[] => {
  const collected: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (entry.isFile() && isProductionSource(entryPath)) {
      collected.push(entryPath);
    }
  }
  return collected;
};

const productionSourceRoots = (): readonly string[] => {
  const roots: string[] = [];
  const packagesDir = join(repoRoot, 'packages');
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const srcDir = join(packagesDir, entry.name, 'src');
      if (existsSync(srcDir)) {
        roots.push(srcDir);
      }
    }
  }
  roots.push(join(repoRoot, 'apps', 'trails', 'src'));
  return roots;
};

describe('overlay collection symmetry (TRL-1209)', () => {
  test('exactly one production source file reads the trailsOverlays module key', () => {
    const matches = productionSourceRoots()
      .flatMap((root) => collectSourceFiles(root))
      .filter((filePath) =>
        MODULE_KEY_READ.test(readFileSync(filePath, 'utf8'))
      )
      .map((filePath) => relative(repoRoot, filePath))
      .toSorted();

    // The adapter-kit resolver is the one shared collection channel. Any
    // second reader reintroduces the per-consumer asymmetry TRL-1209
    // eliminated -- route new consumers through resolveTrailsOverlays.
    expect(matches).toEqual(['packages/adapter-kit/src/overlay.ts']);
  });

  test('compile lease loading and warden topo loading both import the shared resolver', () => {
    const importPattern =
      /import\s*\{[^}]*\bresolveTrailsOverlays\b[^}]*\}\s*from\s*'@ontrails\/adapter-kit'/;
    const consumers = [
      join(repoRoot, 'apps', 'trails', 'src', 'trails', 'load-app.ts'),
      join(repoRoot, 'packages', 'warden', 'src', 'command.ts'),
    ];

    for (const consumer of consumers) {
      expect(importPattern.test(readFileSync(consumer, 'utf8'))).toBe(true);
    }
  });
});
