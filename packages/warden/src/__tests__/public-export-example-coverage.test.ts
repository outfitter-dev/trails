import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';

import {
  checkPublicExportExampleCoverage,
  publicExportExampleCoverage,
  resolvePublicApiExampleTargets,
} from '../rules/public-export-example-coverage.js';
import type { PublicApiPackageTarget } from '../rules/public-export-example-coverage.js';

const RULE_NAME = 'public-export-example-coverage';

// The exported rule anchors its targets to the real repo root resolved from
// the rule module's own URL (packages/warden/src/rules/ → four levels up).
// Tests for the real binding use the same resolution.
const REPO_ROOT = resolve(
  Bun.fileURLToPath(new URL('../../../..', import.meta.url))
);

const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'warden-public-api-'));

afterAll(() => {
  rmSync(FIXTURE_ROOT, { force: true, recursive: true });
});

const FIXTURE_TARGET: PublicApiPackageTarget = {
  indexPath: 'packages/pkg/src/index.ts',
  minimumExports: ['alpha'],
  packageName: '@test/pkg',
};

interface Fixture {
  readonly barrelPath: string;
  readonly targets: ReturnType<typeof resolvePublicApiExampleTargets>;
}

let fixtureCounter = 0;

/**
 * Build a fixture tree under a unique temp root: a barrel plus source
 * modules keyed by barrel-relative path. Returns the resolved targets bound
 * to the fixture root so the rule logic runs against fixture files instead
 * of the real repo barrels.
 */
const buildFixture = (
  barrelSource: string,
  sources: Readonly<Record<string, string>>
): Fixture => {
  fixtureCounter += 1;
  const rootDir = join(FIXTURE_ROOT, `case-${String(fixtureCounter)}`);
  const barrelPath = join(rootDir, FIXTURE_TARGET.indexPath);
  mkdirSync(dirname(barrelPath), { recursive: true });
  writeFileSync(barrelPath, barrelSource);
  for (const [relativePath, content] of Object.entries(sources)) {
    const sourcePath = join(dirname(barrelPath), relativePath);
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, content);
  }
  return {
    barrelPath,
    targets: resolvePublicApiExampleTargets(rootDir, [FIXTURE_TARGET]),
  };
};

const COVERED_ALPHA = `/**
 * Alpha helper.
 *
 * @example
 * \`\`\`ts
 * alpha();
 * \`\`\`
 */
export const alpha = (): number => 1;
`;

const UNCOVERED_ALPHA = `/** Alpha helper without an example. */
export const alpha = (): number => 1;
`;

describe('public-export-example-coverage', () => {
  describe('scope', () => {
    test('ignores files outside the policy targets', () => {
      const diagnostics = publicExportExampleCoverage.check(
        `export { whatever } from './whatever.js';\n`,
        join(REPO_ROOT, 'packages/core/src/index.ts')
      );
      expect(diagnostics).toEqual([]);
    });

    test('internal check ignores non-target barrels under the fixture root', () => {
      const fixture = buildFixture(`export { alpha } from './alpha.js';\n`, {
        'alpha.ts': UNCOVERED_ALPHA,
      });
      const diagnostics = checkPublicExportExampleCoverage(
        `export { alpha } from './alpha.js';\n`,
        join(dirname(fixture.barrelPath), 'other.ts'),
        fixture.targets
      );
      expect(diagnostics).toEqual([]);
    });

    test('baseline: the real repo target barrels emit zero diagnostics', async () => {
      // Mirrors the warden-export-symmetry baseline test: the committed
      // repo state must satisfy the policy the rule enforces.
      const barrels = [
        'packages/cli/src/index.ts',
        'packages/http/src/index.ts',
        'packages/mcp/src/index.ts',
        'adapters/commander/src/index.ts',
        'adapters/hono/src/index.ts',
      ];
      for (const barrel of barrels) {
        const barrelPath = join(REPO_ROOT, barrel);
        const source = await Bun.file(barrelPath).text();
        const diagnostics = publicExportExampleCoverage.check(
          source,
          barrelPath
        );
        expect(diagnostics).toEqual([]);
      }
    });
  });

  describe('coverage diagnostics', () => {
    test('covered minimum export passes', () => {
      const barrel = `export { alpha } from './alpha.js';\n`;
      const fixture = buildFixture(barrel, { 'alpha.ts': COVERED_ALPHA });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics).toEqual([]);
    });

    test('missing @example on a minimum export is an error', () => {
      const barrel = `export { alpha } from './alpha.js';\n`;
      const fixture = buildFixture(barrel, { 'alpha.ts': UNCOVERED_ALPHA });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.rule).toBe(RULE_NAME);
      expect(diagnostics[0]?.message).toContain('@test/pkg');
      expect(diagnostics[0]?.message).toContain('"alpha"');
      expect(diagnostics[0]?.message).toContain('(minimum)');
      expect(diagnostics[0]?.message).toContain('alpha.ts');
    });

    test('missing @example on a non-minimum inventoried export is a warn', () => {
      const barrel = `export { alpha } from './alpha.js';\nexport { beta } from './beta.js';\n`;
      const fixture = buildFixture(barrel, {
        'alpha.ts': COVERED_ALPHA,
        'beta.ts': `export const beta = (): number => 2;\n`,
      });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('warn');
      expect(diagnostics[0]?.message).toContain('"beta"');
      expect(diagnostics[0]?.message).toContain('(inventory)');
    });

    test('aliased re-export checks the imported name', () => {
      const barrel = `export { alphaImpl as alpha } from './alpha.js';\n`;
      const coveredImpl = `/**
 * @example
 * \`\`\`ts
 * alphaImpl();
 * \`\`\`
 */
export const alphaImpl = (): number => 1;
`;
      const fixture = buildFixture(barrel, { 'alpha.ts': coveredImpl });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics).toEqual([]);
    });

    test('aliased re-export reports the imported declaration name when missing', () => {
      const barrel = `export { alphaImpl as alpha } from './alpha.js';\n`;
      const fixture = buildFixture(barrel, {
        'alpha.ts': `export const alphaImpl = (): number => 1;\n`,
      });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('"alpha"');
      expect(diagnostics[0]?.message).toContain('"alphaImpl"');
    });

    test('type-only export declarations and specifiers are skipped', () => {
      const barrel = `export { alpha } from './alpha.js';\nexport type { AlphaShape } from './alpha.js';\nexport { type BetaShape } from './beta.js';\n`;
      const fixture = buildFixture(barrel, {
        'alpha.ts': `${COVERED_ALPHA}export interface AlphaShape { readonly value: number; }\n`,
        'beta.ts': `export interface BetaShape { readonly value: number; }\n`,
      });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics).toEqual([]);
    });

    test('a minimum export absent from the barrel inventory is an error', () => {
      const barrel = `export { beta } from './beta.js';\n`;
      const fixture = buildFixture(barrel, {
        'beta.ts': `/**\n * @example beta()\n */\nexport const beta = (): number => 2;\n`,
      });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('minimum export "alpha"');
      expect(diagnostics[0]?.message).toContain(FIXTURE_TARGET.indexPath);
    });
  });

  describe('inventory limitations', () => {
    test('star re-exports on a target barrel are errors', () => {
      const barrel = `export { alpha } from './alpha.js';\nexport * from './beta.js';\n`;
      const fixture = buildFixture(barrel, {
        'alpha.ts': COVERED_ALPHA,
        'beta.ts': `export const beta = (): number => 2;\n`,
      });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('star re-export');
    });

    test('type-only star re-exports are allowed', () => {
      const barrel = `export { alpha } from './alpha.js';\nexport type * from './beta.js';\n`;
      const fixture = buildFixture(barrel, {
        'alpha.ts': COVERED_ALPHA,
        'beta.ts': `export interface BetaShape { readonly value: number; }\n`,
      });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics).toEqual([]);
    });

    test('non-relative re-export specifiers are errors', () => {
      const barrel = `export { alpha } from './alpha.js';\nexport { something } from '@scope/elsewhere';\n`;
      const fixture = buildFixture(barrel, { 'alpha.ts': COVERED_ALPHA });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('@scope/elsewhere');
    });

    test('local export lists without a module specifier are errors', () => {
      const barrel = `import { alpha } from './alpha.js';\nexport { alpha };\n`;
      const fixture = buildFixture(barrel, { 'alpha.ts': COVERED_ALPHA });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      const limitations = diagnostics.filter((d) =>
        d.message.includes('local export list')
      );
      expect(limitations.length).toBe(1);
      expect(limitations[0]?.severity).toBe('error');
    });

    test('unreadable resolved re-export sources are errors naming the path', () => {
      const barrel = `export { alpha } from './alpha.js';\nexport { ghost } from './ghost.js';\n`;
      const fixture = buildFixture(barrel, { 'alpha.ts': COVERED_ALPHA });
      const diagnostics = checkPublicExportExampleCoverage(
        barrel,
        fixture.barrelPath,
        fixture.targets
      );
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('unreadable source');
      expect(diagnostics[0]?.message).toContain('ghost.ts');
    });
  });
});
