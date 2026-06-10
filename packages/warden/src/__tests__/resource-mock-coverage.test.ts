import { describe, expect, test } from 'bun:test';

import { resourceMockCoverage } from '../rules/resource-mock-coverage.js';

const TEST_FILE = 'resources.ts';

describe('resource-mock-coverage', () => {
  test('flags a resource definition with create but no mock or unmockable', () => {
    const code = `
const db = resource('db.main', {
  create: (resourceCtx) => Result.ok(openDatabase(resourceCtx.env?.DATABASE_URL)),
});`;
    const diagnostics = resourceMockCoverage.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.rule).toBe('resource-mock-coverage');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('db.main');
    expect(diagnostics[0]?.message).toContain('mock');
  });

  test('allows a resource definition with a mock factory', () => {
    const code = `
const db = resource('db.main', {
  create: (resourceCtx) => Result.ok(openDatabase(resourceCtx.env?.DATABASE_URL)),
  mock: () => createInMemoryDb(),
});`;
    expect(resourceMockCoverage.check(code, TEST_FILE)).toHaveLength(0);
  });

  test('allows a resource definition with an explicit unmockable reason', () => {
    const code = `
const clock = resource('system.clock', {
  create: () => Result.ok(realClock()),
  unmockable: { reason: 'wraps the host wall clock; tests inject ctx.now instead' },
});`;
    expect(resourceMockCoverage.check(code, TEST_FILE)).toHaveLength(0);
  });

  test('flags a resource with a non-literal id (dynamic scope) and no mock', () => {
    const code = `
const store = resource(scope, {
  create: async () => Result.ok(await openStore(scope)),
});`;
    const diagnostics = resourceMockCoverage.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.rule).toBe('resource-mock-coverage');
  });

  test('ignores resource definitions in test files', () => {
    const code = `
const db = resource('db.main', {
  create: () => Result.ok(openDatabase()),
});`;
    expect(resourceMockCoverage.check(code, 'foo.test.ts')).toHaveLength(0);
    expect(resourceMockCoverage.check(code, '__tests__/foo.ts')).toHaveLength(
      0
    );
  });

  test('ignores fixture resources in framework-internal packages (warden, testing)', () => {
    const code = `
const invoiceStore = resource('store', {
  create: () => Result.ok({ ok: true }),
});`;
    expect(
      resourceMockCoverage.check(
        code,
        '/repo/packages/warden/src/trails/signal-graph-coaching.trail.ts'
      )
    ).toHaveLength(0);
    expect(
      resourceMockCoverage.check(
        code,
        '/repo/packages/testing/src/fixtures/app.ts'
      )
    ).toHaveLength(0);
  });

  test('ignores resource definitions in .test-d.ts type-fixture files', () => {
    const code = `
export const inferredPlainResource = resource('typecheck.plain', {
  create: (ctx) => Result.ok({ value: ctx.env }),
});`;
    expect(
      resourceMockCoverage.check(code, 'type-checks.test-d.ts')
    ).toHaveLength(0);
  });

  test('does not flag when the spec object uses a spread (cannot verify statically)', () => {
    const code = `
const db = resource('db.main', {
  ...baseSpec,
  create: () => Result.ok(openDatabase()),
});`;
    expect(resourceMockCoverage.check(code, TEST_FILE)).toHaveLength(0);
  });

  test('does not flag when the spec is a referenced variable, not an object literal', () => {
    const code = `
const db = resource('db.main', dbSpec);`;
    expect(resourceMockCoverage.check(code, TEST_FILE)).toHaveLength(0);
  });

  test('does not flag non-resource calls', () => {
    const code = `
const t = trail('entity.show', {
  blaze: async () => Result.ok({ ok: true }),
});`;
    expect(resourceMockCoverage.check(code, TEST_FILE)).toHaveLength(0);
  });

  test('flags each mock-less resource independently in a file with several', () => {
    const code = `
const a = resource('a.store', { create: () => Result.ok(1) });
const b = resource('b.store', { create: () => Result.ok(2), mock: () => 2 });
const c = resource('c.store', { create: () => Result.ok(3) });`;
    const diagnostics = resourceMockCoverage.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(2);
    const ids = diagnostics.map((d) => d.message).join(' ');
    expect(ids).toContain('a.store');
    expect(ids).toContain('c.store');
    expect(ids).not.toContain('b.store');
  });
});
