/**
 * Validates that `ctx.fire()` calls match the declared `fires` array.
 *
 * Statically analyzes trail `blaze` functions to find `ctx.fire('signalId', ...)`
 * calls and compares them against the `fires: [...]` declaration in the trail
 * config. Reports errors for undeclared fires and warnings for unused ones.
 *
 * Mirrors `cross-declarations` structurally — same extraction, same reporting
 * shape, same const-identifier resolution, same context-parameter handling.
 */

import {
  extractFirstStringArg,
  extractStringLiteral,
  findConfigProperty,
  findBlazeBodies,
  findTrailDefinitions,
  identifierName,
  offsetToLine,
  parse,
  resolveConstString,
  walkScope,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

// ---------------------------------------------------------------------------
// Const identifier resolution
// ---------------------------------------------------------------------------

/** Try to resolve an Identifier element to a string via const declaration. */
const resolveIdentifierElement = (
  el: AstNode,
  sourceCode: string
): string | null => {
  const name = identifierName(el);
  if (!name) {
    return null;
  }
  return resolveConstString(name, sourceCode);
};

/**
 * Resolve an array element to a static signal ID when possible.
 *
 * Returns null for entries the rule can't statically resolve — callers should
 * treat "unresolved" as "trust the runtime" rather than a missing declaration.
 * In particular, object-form references (e.g. `fires: [orderPlaced]` where
 * `orderPlaced` is a `Signal` imported from elsewhere) resolve via runtime
 * normalization in `trail()`, not at lint time.
 */
const resolveFireElementId = (
  element: AstNode,
  sourceCode: string
): string | null => {
  const literalValue = extractStringLiteral(element);
  if (literalValue !== null) {
    return literalValue;
  }

  if (element.type === 'Identifier') {
    return resolveIdentifierElement(element, sourceCode);
  }

  return null;
};

// ---------------------------------------------------------------------------
// Declared fires extraction
// ---------------------------------------------------------------------------

/** Extract the ArrayExpression elements from a config's `fires` property. */
const getFiresElements = (config: AstNode): readonly AstNode[] | null => {
  const firesProp = findConfigProperty(config, 'fires');
  if (!firesProp) {
    return null;
  }

  const arrayNode = firesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return null;
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? null;
};

interface DeclaredFires {
  /** Statically resolved signal ids from string literals / const identifiers. */
  readonly ids: ReadonlySet<string>;
  /** True if any element could not be statically resolved (e.g. Signal value). */
  readonly hasUnresolved: boolean;
}

/**
 * Extract declared fires from a `fires: [...]` array.
 *
 * Object-form entries (`fires: [someSignal]`) cannot be resolved at lint time;
 * they're normalized at runtime by `trail()`. When any entry is unresolved,
 * the rule reports `hasUnresolved: true`, and callers should suppress the
 * "undeclared" diagnostic since the declared set is incomplete from our view.
 */
const resolveDeclaredFiresElements = (
  elements: readonly AstNode[],
  sourceCode: string
): DeclaredFires => {
  const ids = new Set<string>();
  let hasUnresolved = false;
  for (const element of elements) {
    const resolved = resolveFireElementId(element, sourceCode);
    if (resolved) {
      ids.add(resolved);
    } else {
      hasUnresolved = true;
    }
  }
  return { hasUnresolved, ids };
};

const extractDeclaredFires = (
  config: AstNode,
  sourceCode: string
): DeclaredFires => {
  const elements = getFiresElements(config);
  return elements
    ? resolveDeclaredFiresElements(elements, sourceCode)
    : { hasUnresolved: false, ids: new Set() };
};

// ---------------------------------------------------------------------------
// Called fires extraction — member expression helpers
// ---------------------------------------------------------------------------

const MEMBER_TYPES = new Set(['StaticMemberExpression', 'MemberExpression']);

/** Extract object and property Identifier names from a MemberExpression. */
const extractMemberPair = (
  callee: AstNode
): { objName: string; propName: string } | null => {
  if (!MEMBER_TYPES.has(callee.type)) {
    return null;
  }

  const objName = identifierName(
    (callee as unknown as { object?: AstNode }).object
  );
  const propName = identifierName(
    (callee as unknown as { property?: AstNode }).property
  );

  return objName && propName ? { objName, propName } : null;
};

/**
 * Extract the second parameter node from a blaze function node.
 *
 * Handles `(input, ctx) => ...`, `async (input, context) => ...`,
 * `function(input, ctx) { ... }`, and parameter-level destructuring
 * like `(input, { fire }) => ...`.
 */
const extractContextParamNode = (blazeBody: AstNode): AstNode | null => {
  const params = blazeBody['params'] as readonly AstNode[] | undefined;
  if (!params || params.length < 2) {
    return null;
  }
  return params[1] ?? null;
};

/** Extract the local name bound to `fire` inside an ObjectPattern Property. */
const extractFireLocalName = (prop: AstNode): string | null => {
  if (prop.type !== 'Property') {
    return null;
  }
  const { key } = prop as unknown as { key?: AstNode };
  const { value } = prop as unknown as { value?: AstNode };
  const keyName = identifierName(key);
  if (keyName !== 'fire') {
    return null;
  }
  // `{ fire }` → key and value are the same Identifier (shorthand).
  // `{ fire: emit }` → value is a distinct Identifier.
  return identifierName(value) ?? keyName;
};

/** Collect `fire` local names from an ObjectPattern's properties into `names`. */
const collectFireNamesFromPattern = (
  pattern: AstNode,
  names: Set<string>
): void => {
  const { properties } = pattern as unknown as {
    properties?: readonly AstNode[];
  };
  if (!properties) {
    return;
  }
  for (const prop of properties) {
    const localName = extractFireLocalName(prop);
    if (localName) {
      names.add(localName);
    }
  }
};

/**
 * Extract the second parameter name from a blaze function node.
 *
 * Returns null when the parameter is not a plain Identifier (e.g. when the
 * author destructures `{ fire }` in the parameter list). Parameter-level
 * destructuring is handled separately by `collectParamFireNames`.
 */
const extractContextParamName = (blazeBody: AstNode): string | null => {
  const param = extractContextParamNode(blazeBody);
  return param ? identifierName(param) : null;
};

/**
 * Collect `fire` local names bound via parameter-level destructuring.
 *
 * Recognizes `(input, { fire }) => ...` and `(input, { fire: emit }) => ...`.
 * When the blaze author destructures in the parameter list, there is no
 * enclosing `ctx` identifier to track — we seed the fire local set directly
 * from the ObjectPattern in `params[1]`.
 */
const collectParamFireNames = (body: AstNode): ReadonlySet<string> => {
  const param = extractContextParamNode(body);
  if (!param || param.type !== 'ObjectPattern') {
    return new Set();
  }
  const names = new Set<string>();
  collectFireNamesFromPattern(param, names);
  return names;
};

/** Check if a callee is a member-style fire call: <ctxName>.fire(...). */
const isMemberFireCall = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>
): boolean => {
  const pair = extractMemberPair(callee);
  return !!pair && ctxNames.has(pair.objName) && pair.propName === 'fire';
};

/**
 * Check if a node is a `<ctxName>.fire(...)` call and return the string signal ID.
 *
 * Also matches bare `<fireLocalName>(...)` calls, but only when the local name
 * was verifiably destructured from the trail context (e.g. `const { fire } = ctx`
 * or `const { fire: emit } = ctx`). Unrelated local `fire()` helpers are
 * ignored — see `collectDestructuredFireNames`.
 */
const isTrackedFireCallee = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>,
  fireLocalNames: ReadonlySet<string>
): boolean => {
  if (isMemberFireCall(callee, ctxNames)) {
    return true;
  }
  const calleeName = identifierName(callee);
  return !!calleeName && fireLocalNames.has(calleeName);
};

const extractFireCallId = (
  node: AstNode,
  ctxNames: ReadonlySet<string>,
  fireLocalNames: ReadonlySet<string>
): string | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const callee = node['callee'] as AstNode | undefined;
  if (!callee) {
    return null;
  }
  return isTrackedFireCallee(callee, ctxNames, fireLocalNames)
    ? extractFirstStringArg(node)
    : null;
};

/**
 * Walk a blaze body and collect local names bound to `ctx.fire` via destructure.
 *
 * Recognizes:
 *   - `const { fire } = ctx;` → adds `fire`
 *   - `const { fire: emit } = context;` → adds `emit`
 *
 * Only destructures whose init is one of the tracked ctx parameter names are
 * accepted. This prevents unrelated local `fire` helpers from being treated as
 * calls into the trail context.
 */
/** Check if a VariableDeclarator destructures from a known ctx identifier. */
const getCtxDestructurePattern = (
  node: AstNode,
  ctxNames: ReadonlySet<string>
): AstNode | null => {
  if (node.type !== 'VariableDeclarator') {
    return null;
  }
  const { id, init } = node as unknown as {
    readonly id?: AstNode;
    readonly init?: AstNode;
  };
  if (!id || id.type !== 'ObjectPattern' || !init) {
    return null;
  }
  const initName = identifierName(init);
  if (!initName || !ctxNames.has(initName)) {
    return null;
  }
  return id;
};

/**
 * Collect `fire` local names destructured from ctx at the TOP LEVEL of the
 * blaze body. Destructures inside nested functions are intentionally ignored
 * to avoid leaking nested-scope bindings into the outer blaze scope — a
 * `const { fire } = ctx` inside a nested helper should not cause an outer
 * bare `fire('x')` to be treated as a ctx-bound call.
 *
 * Tradeoff: nested-scope destructures lose tracking entirely. Calls inside
 * nested functions that rely on their own destructure will not be analyzed.
 * This is a conservative precision loss; a full scope walker is a follow-up.
 *
 * Tradeoff: only `const` destructures are tracked. `let` and `var` bindings
 * allow reassignment (`let { fire } = ctx; fire = other; fire('x')`) which
 * this flow-insensitive walker cannot follow. Skipping them trades a small
 * amount of precision — `let { fire } = ctx` is rare — for eliminating a
 * class of false positives. The runtime + signal-id cross-check still
 * validate real undeclared fires.
 */
/** Get the top-level statements of a blaze function's BlockStatement body. */
const getTopLevelStatements = (body: AstNode): readonly AstNode[] => {
  const blockBody = (body as unknown as { body?: AstNode }).body;
  if (!blockBody || blockBody.type !== 'BlockStatement') {
    return [];
  }
  return (blockBody as unknown as { body?: readonly AstNode[] }).body ?? [];
};

/** Collect fire-local names from a single top-level VariableDeclaration. */
const collectFireNamesFromDeclaration = (
  stmt: AstNode,
  ctxNames: ReadonlySet<string>,
  names: Set<string>
): void => {
  if (stmt.type !== 'VariableDeclaration') {
    return;
  }
  // Only track `const` destructures. `let` and `var` allow reassignment that
  // a single-pass walker cannot track, so `let { fire } = ctx; fire = other;
  // fire('x')` would otherwise be a false positive. Skipping non-const is a
  // small precision loss (see TSDoc on `collectDestructuredFireNames`) in
  // exchange for eliminating that class of false positives.
  const { kind } = stmt as unknown as { kind?: string };
  if (kind !== 'const') {
    return;
  }
  const declarations =
    (stmt as unknown as { declarations?: readonly AstNode[] }).declarations ??
    [];
  for (const decl of declarations) {
    const pattern = getCtxDestructurePattern(decl, ctxNames);
    if (pattern) {
      collectFireNamesFromPattern(pattern, names);
    }
  }
};

const collectDestructuredFireNames = (
  body: AstNode,
  ctxNames: ReadonlySet<string>
): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const stmt of getTopLevelStatements(body)) {
    collectFireNamesFromDeclaration(stmt, ctxNames, names);
  }
  return names;
};

/**
 * Build the set of context parameter names to match against.
 *
 * Returns ONLY the actual second-parameter name from the blaze signature.
 * No seeded defaults: if the blaze has no second parameter, the returned set
 * is empty and no `ctx.fire(...)` / `context.fire(...)` calls are tracked
 * for that blaze. An unrelated closure-scoped `ctx` identifier is not the
 * trail context and must not be treated as one.
 */
const buildCtxNames = (body: AstNode): ReadonlySet<string> => {
  const ctxNames = new Set<string>();
  const paramName = extractContextParamName(body);
  if (paramName) {
    ctxNames.add(paramName);
  }
  return ctxNames;
};

/**
 * Walk blaze bodies and collect all statically resolvable ctx.fire() signal IDs.
 *
 * Traversal uses `walkScope`, which stops at nested function boundaries
 * (FunctionDeclaration, FunctionExpression, ArrowFunctionExpression). This
 * mirrors the top-level-only behavior of `collectDestructuredFireNames` and
 * avoids false positives when a nested function parameter shadows `ctx` or a
 * destructured `fire` local:
 *
 * ```ts
 * blaze: async (_, ctx) => {
 *   const { fire } = ctx;
 *   function nested(fire) { fire('shadow'); } // ignored — shadowed
 *   function other(ctx)  { ctx.fire('x'); }   // ignored — shadowed
 *   return Result.ok({});
 * }
 * ```
 *
 * Tradeoff: legitimate `ctx.fire(...)` calls inside nested helpers are not
 * statically analyzed. The runtime + signal-id cross-check still validate
 * them; the warden just can't prove them at lint time. A full scope walker is
 * a follow-up if this precision loss becomes meaningful in practice.
 */
const extractCalledFires = (config: AstNode): ReadonlySet<string> => {
  const ids = new Set<string>();

  for (const body of findBlazeBodies(config)) {
    const ctxNames = buildCtxNames(body);
    const bodyFireNames = collectDestructuredFireNames(body, ctxNames);
    const paramFireNames = collectParamFireNames(body);
    const fireLocalNames = new Set<string>([
      ...bodyFireNames,
      ...paramFireNames,
    ]);

    walkScope(body, (node) => {
      const id = extractFireCallId(node, ctxNames, fireLocalNames);
      if (id) {
        ids.add(id);
      }
    });
  }

  return ids;
};

// ---------------------------------------------------------------------------
// Diagnostic builders
// ---------------------------------------------------------------------------

const buildUndeclaredDiagnostic = (
  trailId: string,
  signalId: string,
  filePath: string,
  line: number,
  softened = false
): WardenDiagnostic => ({
  filePath,
  line,
  message: softened
    ? `Trail "${trailId}": ctx.fire('${signalId}') called but '${signalId}' is not declared in fires (may be declared via object-form fires entries)`
    : `Trail "${trailId}": ctx.fire('${signalId}') called but '${signalId}' is not declared in fires`,
  rule: 'fires-declarations',
  severity: softened ? 'warn' : 'error',
});

const buildUnusedDiagnostic = (
  trailId: string,
  signalId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": '${signalId}' declared in fires but ctx.fire('${signalId}') never called`,
  rule: 'fires-declarations',
  severity: 'warn',
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Emit error for each called ID not present in declared set. */
const reportUndeclared = (
  called: ReadonlySet<string>,
  declared: ReadonlySet<string>,
  ctx: {
    trailId: string;
    filePath: string;
    line: number;
    softened?: boolean;
  },
  diagnostics: WardenDiagnostic[]
): void => {
  for (const id of called) {
    if (!declared.has(id)) {
      diagnostics.push(
        buildUndeclaredDiagnostic(
          ctx.trailId,
          id,
          ctx.filePath,
          ctx.line,
          ctx.softened
        )
      );
    }
  }
};

/**
 * Emit warning for each declared ID not present in called set.
 *
 * Note: unlike `reportUndeclared`, this function does NOT soften its
 * diagnostics when `hasUnresolved` is true. The asymmetry is intentional —
 * softening only applies to the undeclared direction because unresolved
 * Signal-value entries might cover an unknown set of called IDs. In the
 * unused direction, a declared string-literal that is never called is
 * genuinely unused regardless of whether other entries are unresolved.
 */
const reportUnused = (
  declared: ReadonlySet<string>,
  called: ReadonlySet<string>,
  ctx: { trailId: string; filePath: string; line: number },
  diagnostics: WardenDiagnostic[]
): void => {
  for (const id of declared) {
    if (!called.has(id)) {
      diagnostics.push(
        buildUnusedDiagnostic(ctx.trailId, id, ctx.filePath, ctx.line)
      );
    }
  }
};

const checkTrailDefinition = (
  def: { id: string; config: AstNode; start: number },
  filePath: string,
  sourceCode: string,
  diagnostics: WardenDiagnostic[]
): void => {
  const declared = extractDeclaredFires(def.config, sourceCode);
  const called = extractCalledFires(def.config);

  if (declared.ids.size === 0 && !declared.hasUnresolved && called.size === 0) {
    return;
  }

  const line = offsetToLine(sourceCode, def.start);
  const ctx = { filePath, line, trailId: def.id };

  // When the declared array contains object-form references we can't resolve,
  // downgrade "undeclared" diagnostics from error to warn with a disclaimer
  // instead of suppressing entirely. The developer still sees genuinely
  // undeclared calls, but we can't statically prove the call isn't covered by
  // a Signal-value entry the runtime will normalize.
  reportUndeclared(
    called,
    declared.ids,
    { ...ctx, softened: declared.hasUnresolved },
    diagnostics
  );
  reportUnused(declared.ids, called, ctx, diagnostics);
};

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

/**
 * Validates that `ctx.fire()` calls align with declared `fires` arrays.
 */
export const firesDeclarations: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];

    for (const def of findTrailDefinitions(ast)) {
      checkTrailDefinition(def, filePath, sourceCode, diagnostics);
    }

    return diagnostics;
  },
  description:
    'Ensure ctx.fire() calls match the declared fires array in trail definitions.',
  name: 'fires-declarations',
  severity: 'error',
};
