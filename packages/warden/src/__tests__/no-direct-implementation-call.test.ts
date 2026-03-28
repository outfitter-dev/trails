import { describe, expect, test } from 'bun:test';

import { noDirectImplementationCall } from '../rules/no-direct-implementation-call.js';

describe('no-direct-implementation-call', () => {
  test('flags direct implementation access in application code', () => {
    const code = `
import { trail, Result } from "@ontrails/core";

const entityShow = trail("entity.show", {
  run: async (input, ctx) => Result.ok({ id: input.id }),
});

async function run() {
  const result = await entityShow.run({ id: "1" }, ctx);
  return result;
}`;

    const diagnostics = noDirectImplementationCall.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-direct-implementation-call');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('ctx.follow');
  });

  test('allows ctx.follow() calls', () => {
    const code = `
trail("entity.onboard", {
  follow: ["entity.create"],
  run: async (input, ctx) => {
    const result = await ctx.follow("entity.create", input);
    return Result.ok(result);
  },
});
`;

    const diagnostics = noDirectImplementationCall.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores test files', () => {
    const code = `
async function run() {
  return await entityShow.run({ id: "1" }, ctx);
}`;

    const diagnostics = noDirectImplementationCall.check(
      code,
      'src/__tests__/app.test.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores framework internals that intentionally call implementations', () => {
    const code = `
export async function run() {
  return await entityShow.run({ id: "1" }, ctx);
}`;

    const diagnostics = noDirectImplementationCall.check(
      code,
      '/repo/packages/testing/src/trail.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores implementation references inside template strings', () => {
    const code = `
const generated = \`const result = await entityShow.run({ id: "1" }, ctx);\`;
`;

    const diagnostics = noDirectImplementationCall.check(
      code,
      'src/new-trail.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });
});
