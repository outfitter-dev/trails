import { describe, expect, test } from 'bun:test';

import { implementationReturnsResult } from '../rules/implementation-returns-result.js';

const TEST_FILE = 'test.ts';

describe('implementation-returns-result', () => {
  test('flags raw object return in trail implementation', () => {
    const code = `
trail("entity.show", {
  implementation: async (input, ctx) => {
    return { name: "foo" };
  }
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.rule).toBe('implementation-returns-result');
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('allows Result.ok() and returning ctx.follow() results', () => {
    const code = `
hike("entity.onboard", {
  implementation: async (input, ctx) => {
    const result = await ctx.follow("entity.create", input);
    return result;
  }
})

trail("entity.create", {
  implementation: async (input, ctx) => Result.ok({ id: "123" })
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(0);
  });

  test('flags concise raw implementation bodies', () => {
    const code = `
trail("entity.create", {
  implementation: async (input, ctx) => ({ id: "123" })
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.create');
  });

  test('allows returning explicitly Result-typed local helpers', () => {
    const code = `
const buildDetail = (trailId: string): Result<object, Error> =>
  Result.ok({ trailId });

const buildDiff = async (): Promise<Result<object, Error>> =>
  Result.ok({ breaking: [] });

trail("survey", {
  implementation: async (input, ctx) => {
    if (input.diff) {
      return await buildDiff();
    }

    return buildDetail(input.trailId);
  }
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(0);
  });
});
