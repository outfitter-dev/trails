import { describe, expect, test } from 'bun:test';

import { wardenRules, wardenTopoRules } from '../rules/index.js';
import { registeredRuleNames } from '../rules/registry-names.js';
import { wardenExportSymmetry } from '../rules/warden-export-symmetry.js';

const SELF_RULE_NAME = 'warden-export-symmetry';

const TARGET_FILE = 'packages/warden/src/index.ts';
const UNRELATED_FILE = 'packages/warden/src/cli.ts';

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
  test('only targets packages/warden/src/index.ts', () => {
    const source = buildIndexSource();
    const diagnostics = wardenExportSymmetry.check(source, UNRELATED_FILE);
    expect(diagnostics).toEqual([]);
  });

  test('baseline: current warden barrel emits zero diagnostics', async () => {
    const realPath = Bun.fileURLToPath(new URL('../index.ts', import.meta.url));
    const source = await Bun.file(realPath).text();
    const diagnostics = wardenExportSymmetry.check(source, realPath);
    expect(diagnostics).toEqual([]);
  });

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

  test('registry-names snapshot matches the live registry', () => {
    const live = new Set([...wardenRules.keys(), ...wardenTopoRules.keys()]);
    const snapshot = new Set([...registeredRuleNames, SELF_RULE_NAME]);
    // Symmetric diff: both directions must be empty. Any missing / extra name
    // means `registry-names.ts` drifted from `rules/index.ts`.
    const missingFromSnapshot = [...live].filter((n) => !snapshot.has(n));
    const extraInSnapshot = [...snapshot].filter((n) => !live.has(n));
    expect(missingFromSnapshot).toEqual([]);
    expect(extraInSnapshot).toEqual([]);
  });

  test('fires on namespace re-exports (export * from ...)', () => {
    const source = `${buildIndexSource()}export * from './trails/index.js';\n`;
    const diagnostics = wardenExportSymmetry.check(source, TARGET_FILE);
    const nsReexports = diagnostics.filter((d) =>
      d.message.includes('namespace re-export')
    );
    expect(nsReexports.length).toBe(1);
    expect(nsReexports[0]?.severity).toBe('error');
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
