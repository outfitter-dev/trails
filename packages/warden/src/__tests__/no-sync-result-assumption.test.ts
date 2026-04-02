import { describe, expect, test } from 'bun:test';

import { noSyncResultAssumption } from '../rules/no-sync-result-assumption.js';

describe('no-sync-result-assumption', () => {
  test('flags direct result access on implementation calls', () => {
    const code = `
async function run() {
  const isOk = entityShow.blaze({ id: "1" }, ctx).isOk();
  return isOk;
}`;

    const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-sync-result-assumption');
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.message).toContain('Missing await');
  });

  test('flags a stored implementation result that is used synchronously', () => {
    const code = `
const result = entityShow.blaze({ id: "1" }, ctx);

if (result.isOk()) {
  console.log("ok");
}`;

    const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(4);
  });

  test('allows awaited implementation calls before result access', () => {
    const code = `
async function run() {
  const result = await entityShow.blaze({ id: "1" }, ctx);
  return result.isOk();
}`;

    const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('allows awaited implementation calls when the property access is chained', () => {
    const code = `
async function run() {
  return (await entityShow.blaze({ id: "1" }, ctx)).isOk();
}`;

    const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores test files', () => {
    const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
result.isOk();
`;

    const diagnostics = noSyncResultAssumption.check(
      code,
      'src/__tests__/app.test.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores framework internals that intentionally call implementations', () => {
    const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
result.isOk();
`;

    const diagnostics = noSyncResultAssumption.check(
      code,
      '/repo/packages/testing/src/trail.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });
});
