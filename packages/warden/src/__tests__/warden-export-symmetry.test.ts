import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { wardenRules, wardenTopoRules } from '../rules/index.js';
import { registeredRuleNames } from '../rules/registry-names.js';
import { wardenExportSymmetry } from '../rules/warden-export-symmetry.js';

const SELF_RULE_NAME = 'warden-export-symmetry';

// The rule anchors to this package's own on-disk `src/index.ts`. Tests must
// use the same resolved path so the rule actually engages.
const TARGET_FILE = resolve(
  Bun.fileURLToPath(new URL('../index.ts', import.meta.url))
);
const UNRELATED_FILE = resolve(
  Bun.fileURLToPath(new URL('../cli.ts', import.meta.url))
);

const kebabToCamel = (value: string): string =>
  value.replaceAll(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const allRuleNames = [...wardenRules.keys(), ...wardenTopoRules.keys()];

const expectedTrailExports = allRuleNames
  .map((name) => `${kebabToCamel(name)}Trail`)
  .toSorted();

const [sampleTrailExport = 'missingTrailExportSentinel'] = expectedTrailExports;
const [sampleRuleName = 'missing-rule-sentinel'] = allRuleNames;
const sampleRawRuleCamel = kebabToCamel(sampleRuleName);

const buildIndexSource = (extraExports = '', skip: readonly string[] = []) => {
  const skipSet = new Set(skip);
  const rendered = expectedTrailExports
    .filter((name) => !skipSet.has(name))
    .map((name) => `  ${name},`)
    .join('\n');
  return `export {
${rendered}
} from './trails/index.js';
${extraExports}
`;
};

describe('warden-export-symmetry', () => {
  describe('scope', () => {
    test("only targets this package's own src/index.ts", () => {
      const source = buildIndexSource();
      const diagnostics = wardenExportSymmetry.check(source, UNRELATED_FILE);
      expect(diagnostics).toEqual([]);
    });

    test('ignores a foreign packages/warden/src/index.ts in another repo', () => {
      // Simulate a consumer repo that happens to have the same folder
      // structure. A path suffix match would incorrectly engage the rule here
      // and flood the consumer with bogus diagnostics.
      const foreignRepo = mkdtempSync(join(tmpdir(), 'warden-foreign-'));
      const foreignBarrelDir = join(foreignRepo, 'packages/warden/src');
      mkdirSync(foreignBarrelDir, { recursive: true });
      const foreignBarrel = join(foreignBarrelDir, 'index.ts');
      // Contents that WOULD trip every check if the rule ran: missing trails,
      // raw rule leak, namespace re-export, default export.
      writeFileSync(
        foreignBarrel,
        `export { ${sampleRawRuleCamel} } from './rules/index.js';\nexport * from './trails/index.js';\nexport default {};\n`
      );
      const diagnostics = wardenExportSymmetry.check(
        `export { ${sampleRawRuleCamel} } from './rules/index.js';\nexport * from './trails/index.js';\nexport default {};\n`,
        foreignBarrel
      );
      expect(diagnostics).toEqual([]);
    });

    test('baseline: current warden barrel emits zero diagnostics', async () => {
      const realPath = Bun.fileURLToPath(
        new URL('../index.ts', import.meta.url)
      );
      const source = await Bun.file(realPath).text();
      const diagnostics = wardenExportSymmetry.check(source, realPath);
      expect(diagnostics).toEqual([]);
    });

    test('registry-names snapshot matches the live registry', () => {
      const live = new Set([...wardenRules.keys(), ...wardenTopoRules.keys()]);
      const snapshot = new Set([...registeredRuleNames, SELF_RULE_NAME]);
      const missingFromSnapshot = [...live].filter((n) => !snapshot.has(n));
      const extraInSnapshot = [...snapshot].filter((n) => !live.has(n));
      expect(missingFromSnapshot).toEqual([]);
      expect(extraInSnapshot).toEqual([]);
    });
  });

  describe('symmetry diagnostics', () => {
    test('fires when a registry entry has no matching trail export', () => {
      const source = buildIndexSource('', [sampleTrailExport]);
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const missing = diagnostics.filter((d) =>
        d.message.includes(`missing trail export "${sampleTrailExport}"`)
      );
      expect(missing.length).toBe(1);
      expect(missing[0]?.severity).toBe('error');
    });

    test('fires when a *Trail export has no matching registry entry', () => {
      const source = buildIndexSource(
        `export { fictitiousGhostTrail } from './trails/index.js';\n`
      );
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const orphans = diagnostics.filter((d) =>
        d.message.includes('fictitiousGhostTrail')
      );
      expect(orphans.length).toBe(1);
      expect(orphans[0]?.severity).toBe('error');
    });

    test('fires on orphan *Trail declared via `export const`', () => {
      const source = buildIndexSource(
        `export const fictitiousGhostTrail = {} as unknown;\n`
      );
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const orphans = diagnostics.filter((d) =>
        d.message.includes('fictitiousGhostTrail')
      );
      expect(orphans.length).toBe(1);
      expect(orphans[0]?.severity).toBe('error');
    });
  });

  describe('raw-rule leaks', () => {
    test('fires when a raw rule object is re-exported on the barrel', () => {
      const source = buildIndexSource(
        `export { ${sampleRawRuleCamel} } from './rules/index.js';\n`
      );
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const rawLeaks = diagnostics.filter((d) =>
        d.message.includes(`raw rule export "${sampleRawRuleCamel}"`)
      );
      expect(rawLeaks.length).toBe(1);
      expect(rawLeaks[0]?.severity).toBe('error');
    });

    test('fires on aliased raw-rule re-exports using the local binding name', () => {
      const source = buildIndexSource(
        `export { ${sampleRawRuleCamel} as disguisedRule } from './rules/index.js';\n`
      );
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const rawLeaks = diagnostics.filter((d) =>
        d.message.includes(`raw rule export "${sampleRawRuleCamel}"`)
      );
      expect(rawLeaks.length).toBe(1);
      expect(rawLeaks[0]?.severity).toBe('error');
    });
  });

  describe('forbidden barrel shapes', () => {
    test('fires on namespace re-exports (export * from ...)', () => {
      const source = `${buildIndexSource()}export * from './trails/index.js';\n`;
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const nsReexports = diagnostics.filter((d) =>
        d.message.includes('namespace re-export')
      );
      expect(nsReexports.length).toBe(1);
      expect(nsReexports[0]?.severity).toBe('error');
      // Regression guard: plain `export *` must not mention an ` as ` alias.
      expect(nsReexports[0]?.message).not.toContain(' as ');
      expect(nsReexports[0]?.message).toContain(
        "export * from './trails/index.js'"
      );
    });

    test('fires on aliased namespace re-exports and preserves the alias', () => {
      const source = `${buildIndexSource()}export * as trailsNs from './trails/index.js';\n`;
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const nsReexports = diagnostics.filter((d) =>
        d.message.includes('namespace re-export')
      );
      expect(nsReexports.length).toBe(1);
      expect(nsReexports[0]?.severity).toBe('error');
      expect(nsReexports[0]?.message).toContain(
        "export * as trailsNs from './trails/index.js'"
      );
    });

    test('rejects `export default` on the warden barrel', () => {
      const source = `${buildIndexSource()}export default {};\n`;
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const defaults = diagnostics.filter((d) =>
        d.message.includes('default export')
      );
      expect(defaults.length).toBe(1);
      expect(defaults[0]?.severity).toBe('error');
    });
  });

  describe('type-only namespace re-exports', () => {
    test('allows `export type * from ...`', () => {
      const source = `${buildIndexSource()}export type * from './rules/types.js';\n`;
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const nsReexports = diagnostics.filter((d) =>
        d.message.includes('namespace re-export')
      );
      expect(nsReexports).toEqual([]);
    });

    test('allows `export type * as ns from ...`', () => {
      const source = `${buildIndexSource()}export type * as types from './rules/types.js';\n`;
      const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
      const nsReexports = diagnostics.filter((d) =>
        d.message.includes('namespace re-export')
      );
      expect(nsReexports).toEqual([]);
    });
  });
});
