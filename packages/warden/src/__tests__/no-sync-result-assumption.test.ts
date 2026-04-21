import { describe, expect, test } from 'bun:test';

import { noSyncResultAssumption } from '../rules/no-sync-result-assumption.js';

describe('no-sync-result-assumption', () => {
  describe('core behavior', () => {
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

    test('ignores .blaze() inside a template-literal string payload', () => {
      const code =
        'const example = `const x = entityShow.blaze(input, ctx).isOk()`;';

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('ignores .blaze() inside a double-quoted string payload', () => {
      const code = 'const example = "entityShow.blaze(input, ctx).isOk()";';

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('allows awaited indirection through destructured call', () => {
      const code = `
async function run() {
  const result = (await entityShow.blaze({ id: "1" }, ctx));
  return result.isErr();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('lexical scoping', () => {
    test('does not flag a parameter that shadows a pending binding', () => {
      const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
function ok(result) {
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('does not flag a local block-scoped shadow of a pending binding', () => {
      const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
{
  const result = { isOk: () => true };
  if (result.isOk()) {
    console.log("inner");
  }
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('does not flag a local block-scoped class that shadows a pending binding', () => {
      const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
{
  class result {
    static isOk() { return true; }
  }
  if (result.isOk()) {
    console.log("inner");
  }
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('does not flag an arrow parameter that shadows a pending binding', () => {
      const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
const f = (result) => result.isOk();`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('does not flag a deeply nested shadowed parameter', () => {
      const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
function outer() {
  const result = 1;
  function inner(result) {
    return result.isOk();
  }
  return inner;
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('still flags outer pending binding referenced from a non-shadowing nested function', () => {
      const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
function ok() {
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('does not flag a destructured parameter that shadows a pending binding', () => {
      const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
function ok({ result }) {
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('does not flag a catch binding that shadows a pending binding', () => {
      const code = `
const result = entityShow.blaze({ id: "1" }, ctx);
try {
  doThing();
} catch (result) {
  if (result.isOk) console.log(result.isOk);
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('var hoisting', () => {
    test('var declared inside a block hoists to the enclosing function', () => {
      const code = `
function run() {
  if (cond) {
    var result = entityShow.blaze({ id: "1" }, ctx);
  }
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('var declared in a for-head hoists to the enclosing function', () => {
      const code = `
function run() {
  for (var result = entityShow.blaze({ id: "1" }, ctx); ;) { break; }
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('let declared inside a block stays block-scoped', () => {
      const code = `
function run() {
  if (cond) {
    let result = entityShow.blaze({ id: "1" }, ctx);
  }
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('var re-init of a same-named parameter registers as a pending binding', () => {
      // `var` and parameters share the function's VariableEnvironment, so
      // `var result = blaze(...)` writes to the parameter's slot. After the
      // declaration runs, `result.isOk()` observes the blaze result and
      // must fire, just as it would in the no-parameter case.
      const code = `
function run(result) {
  var result = entityShow.blaze({ id: "1" }, ctx);
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('var re-init of a parameter inside a block still hoists to function scope', () => {
      const code = `
function run(result) {
  if (cond) {
    var result = entityShow.blaze({ id: "1" }, ctx);
  }
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('var re-init of a parameter with no later result-shaped use is not flagged', () => {
      // Registering the pending binding is fine, but nothing consumes it
      // as a sync `Result`, so no diagnostic is emitted.
      const code = `
function run(result) {
  var result = entityShow.blaze({ id: "1" }, ctx);
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('plain `=` re-assignment to a same-named parameter registers as a pending binding', () => {
      // `result = blaze(...)` writes to the parameter's existing slot in
      // the same VariableEnvironment, so the subsequent `result.isOk()`
      // observes the blaze result and must fire.
      const code = `
function run(result) {
  result = entityShow.blaze({ id: "1" }, ctx);
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('parameter used directly as a Result without re-init is not flagged', () => {
      // The parameter is the real binding; nothing made it a pending
      // `.blaze()` result, so `result.isOk()` is just a call on whatever
      // was passed in.
      const code = `
function run(result) {
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('static blocks', () => {
    test('inner const in static block shadows outer pending binding', () => {
      const code = `
const result = trail.blaze({ id: "1" }, ctx);
class Foo {
  static {
    const result = 42;
    result.toString();
  }
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('pending binding inside a static block flows to use inside the same static block', () => {
      const code = `
class Foo {
  static {
    const result = trail.blaze({ id: "1" }, ctx);
    result.isOk();
  }
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('static block bindings do not leak out to enclosing scope', () => {
      const code = `
class Foo {
  static {
    const result = trail.blaze({ id: "1" }, ctx);
  }
}
result.isOk();`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('flags var-declared blaze result used inside the same static block', () => {
      const code = `
class Foo {
  static {
    var result = entityShow.blaze({ id: "1" }, ctx);
    result.isOk();
  }
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('does not let a static-block var leak to the enclosing scope', () => {
      const code = `
class Foo {
  static {
    var result = entityShow.blaze({ id: "1" }, ctx);
  }
}

function outer() {
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('parenthesized blaze calls', () => {
    test('flags member access on a parens-wrapped blaze call', () => {
      const code = `
function run() {
  return (entityShow.blaze({ id: "1" }, ctx)).isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags .value access on a parens-wrapped blaze call', () => {
      const code = `
function run() {
  return (entityShow.blaze({ id: "1" }, ctx)).value;
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags member access through double-wrapped parens', () => {
      const code = `
function run() {
  return ((entityShow.blaze({ id: "1" }, ctx))).isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags accessor use on a binding whose init is a parens-wrapped blaze call', () => {
      const code = `
function run() {
  const result = (entityShow.blaze({ id: "1" }, ctx));
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags accessor use on a binding whose init is a double-parens blaze call', () => {
      const code = `
function run() {
  const result = ((entityShow.blaze({ id: "1" }, ctx)));
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags destructuring of a Result accessor from a parens-wrapped blaze call', () => {
      const code = `
function run() {
  const { isOk } = (entityShow.blaze({ id: "1" }, ctx));
  return isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags accessor use on a binding whose init is a TSAsExpression-wrapped blaze call', () => {
      const code = `
function run() {
  const result = entityShow.blaze({ id: "1" }, ctx) as any;
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags accessor use on a binding whose init is a TSSatisfiesExpression-wrapped blaze call', () => {
      const code = `
function run() {
  const result = entityShow.blaze({ id: "1" }, ctx) satisfies unknown;
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags accessor use on a binding whose init is a TSNonNullExpression-wrapped blaze call', () => {
      const code = `
function run() {
  const result = entityShow.blaze({ id: "1" }, ctx)!;
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });
  });

  describe('destructured bindings', () => {
    test('flags object destructuring of a Result accessor from an unawaited blaze call', () => {
      const code = `
function run() {
  const { isOk } = entityShow.blaze({ id: "1" }, ctx);
  return isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags destructuring of value from an unawaited blaze call', () => {
      const code = `
function run() {
  const { value } = entityShow.blaze({ id: "1" }, ctx);
  return value;
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('does not flag destructuring of a Result accessor from an awaited blaze call', () => {
      const code = `
async function run() {
  const { isOk } = await entityShow.blaze({ id: "1" }, ctx);
  return isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });
  });

  test('flags .value access on unawaited blaze call', () => {
    const code = `
function run() {
  return entityShow.blaze({ id: "1" }, ctx).value;
}`;

    const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('Missing await');
  });

  describe('conditional-expression inits', () => {
    test('flags accessor use when blaze call is the consequent branch', () => {
      const code = `
function run(cond, fallback) {
  const result = cond ? entityShow.blaze({ id: "1" }, ctx) : fallback;
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags accessor use when blaze call is the alternate branch', () => {
      const code = `
function run(cond, fallback) {
  const result = cond ? fallback : entityShow.blaze({ id: "1" }, ctx);
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags accessor use when both branches are blaze calls', () => {
      const code = `
function run(cond) {
  const result = cond
    ? entityShow.blaze({ id: "1" }, ctx)
    : entityEdit.blaze({ id: "1" }, ctx);
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('does not flag when the conditional is awaited as a whole', () => {
      const code = `
async function run(cond, fallback) {
  const result = await (cond ? entityShow.blaze({ id: "1" }, ctx) : fallback);
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('flags destructuring of a Result accessor from a conditional branch', () => {
      const code = `
function run(cond, fallback) {
  const { isOk } = cond ? entityShow.blaze({ id: "1" }, ctx) : fallback;
  return isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags direct accessor call through a conditional wrapper', () => {
      const code = `
function run(cond, fallback) {
  return (cond ? entityShow.blaze({ id: "1" }, ctx) : fallback).isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });
  });

  describe('logical-expression inits', () => {
    test('flags accessor use when blaze is the right operand of &&', () => {
      const code = `
function run(cond) {
  const result = cond && entityShow.blaze({ id: "1" }, ctx);
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags accessor use when blaze is the right operand of ??', () => {
      const code = `
function run(maybe) {
  const result = maybe ?? entityShow.blaze({ id: "1" }, ctx);
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags accessor use when blaze is the right operand of ||', () => {
      const code = `
function run(fallback) {
  const result = fallback || entityShow.blaze({ id: "1" }, ctx);
  return result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags direct accessor call through a logical wrapper', () => {
      const code = `
function run(cond) {
  return (cond && entityShow.blaze({ id: "1" }, ctx)).isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('does not flag when the logical expression is awaited as a whole', () => {
      const code = `
async function run(cond) {
  const result = await (cond && entityShow.blaze({ id: "1" }, ctx));
  return result?.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('assignment to pre-declared variable', () => {
    test('flags bare identifier assignment followed by result access', () => {
      const code = `
async function run(ctx) {
  let result;
  result = entityShow.blaze({ id: "1" }, ctx);
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags logical-wrapped assignment to pre-declared variable', () => {
      const code = `
async function run(cond, ctx) {
  let result;
  result = cond && entityShow.blaze({ id: "1" }, ctx);
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('ignores member-expression assignment', () => {
      const code = `
async function run(obj, ctx) {
  obj.result = entityShow.blaze({ id: "1" }, ctx);
  obj.result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('ignores plain assignments unrelated to blaze', () => {
      const code = `
async function run() {
  let result = 0;
  result = 42;
  return result;
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });
  });
});

describe('no-sync-result-assumption — pending re-assignment', () => {
  describe('pending binding re-assignment', () => {
    test('clears pending after re-assignment to a non-blaze value', () => {
      const code = `
async function run(ctx) {
  let result = entityShow.blaze({ id: "1" }, ctx);
  result = 42;
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('keeps pending after re-assignment to another blaze call', () => {
      const code = `
async function run(ctx) {
  let result = entityShow.blaze({ id: "1" }, ctx);
  result = entityShow.blaze({ id: "2" }, ctx);
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('does not clear pending when a member-expression LHS is written', () => {
      const code = `
async function run(ctx, obj) {
  let result = entityShow.blaze({ id: "1" }, ctx);
  obj.result = 42;
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('clears pending after a mathematical compound assignment', () => {
      const code = `
async function run(ctx) {
  let result = entityShow.blaze({ id: "1" }, ctx);
  result += 1;
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });

    test('keeps pending after a logical compound assignment (??=)', () => {
      const code = `
async function run(ctx, fallback) {
  let result = entityShow.blaze({ id: "1" }, ctx);
  result ??= fallback;
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('keeps pending after a logical compound assignment (||=)', () => {
      // Mirrors the `??=` case: `||=` only writes when the LHS is falsy, and
      // a pending `Promise<Result>` is truthy, so the pending binding must
      // survive.
      const code = `
async function run(ctx, fallback) {
  let result = entityShow.blaze({ id: "1" }, ctx);
  result ||= fallback;
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('flags self-referential re-assignment that accesses Result members on RHS', () => {
      // Regression for the pre-order-clear bug. `result = result.value` must
      // fire on the RHS `result.value` BEFORE the assignment clears the
      // pending binding — otherwise the missing-await diagnostic would
      // silently disappear even though the RHS reads a Result accessor from
      // the same pending slot.
      const code = `
async function run(ctx) {
  let result = entityShow.blaze({ id: "1" }, ctx);
  result = result.value;
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('Missing await');
    });

    test('clears pending after a logical-AND compound assignment (&&=)', () => {
      // `&&=` writes the RHS when the LHS is truthy. A pending
      // Promise<Result> is truthy, so the RHS always runs and the pending
      // slot is overwritten — the subsequent `result.isOk()` observes the
      // fallback, not the blaze result, so no diagnostic should fire.
      const code = `
async function run(ctx, fallback) {
  let result = entityShow.blaze({ id: "1" }, ctx);
  result &&= fallback;
  result.isOk();
}`;

      const diagnostics = noSyncResultAssumption.check(code, 'src/app.ts');

      expect(diagnostics).toHaveLength(0);
    });
  });
});
