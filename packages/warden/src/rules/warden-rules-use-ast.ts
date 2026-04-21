/**
 * Self-governance rule: warden rules must inspect the AST via the helpers in
 * `./ast.ts` rather than regex-scanning raw source text. Raw-text scans
 * produce false positives on string literals, template payloads, and
 * docstrings — see TRL-335 and ADR-0036.
 *
 * Three detection families are enforced:
 *
 * 1. `rawScanSite` — string methods on a raw-source identifier, e.g.
 *    `sourceCode.split(/\n/)`, `rawText.match(...)`, `text.replace(...)`.
 * 2. `regexScanSite` — regex-receiver methods consuming a raw-source
 *    argument, e.g. `/re/.test(sourceCode)`, `new RegExp(...).exec(text)`.
 * 3. `regexConstructionSite` — constructing a regex directly from a raw
 *    source identifier, e.g. `new RegExp(sourceCode)`, `RegExp(rawText, 'g')`.
 *    Interpolating raw source into a regex constructor is the same class of
 *    bug as scanning with one — see TRL-345.
 *
 * This rule is path-anchored to this package's own `src/rules/` directory so
 * it never fires against a consumer repo that happens to share the same
 * folder layout. `ast.ts` itself is excluded because it IS the raw-text
 * interface to the parser; `types.ts`, `index.ts`, `registry-names.ts`, and
 * anything under `__tests__` are also excluded.
 */
import { basename as pathBasename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { offsetToLine, parse, walk } from './ast.js';
import type { AstNode } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'warden-rules-use-ast';

/**
 * Absolute path to this package's rules directory, resolved from the rule's
 * own module URL. Anchoring to the real on-disk location prevents the rule
 * from firing against a foreign `packages/warden/src/rules/` in a consumer
 * repository that happens to share the same folder structure.
 *
 * Dist-layout safeguard: when this module is bundled/transpiled to `dist/`
 * (e.g. `packages/warden/dist/rules/warden-rules-use-ast.js`), the files
 * being linted still live under `src/rules/`. A strict equality check
 * against only the dist directory would cause the rule to silently emit
 * zero diagnostics — a silent no-op. To keep the anchor robust, we compute
 * a source-equivalent dir by substituting `/dist/` with `/src/` on the
 * resolved path and accept either. This preserves the anti-false-positive
 * guarantee from TRL-341 (we still require an exact directory match, not a
 * suffix match) while surviving a future bundling change.
 */
const SELF_MODULE_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * Replace only the LAST occurrence of `/dist/` with `/src/`. A blanket
 * `replaceAll` over-substitutes on paths that contain other `/dist/`
 * segments higher up (e.g. `/home/runner/dist-artifacts/warden/dist/rules/`
 * would incorrectly become `/home/runner/src-artifacts/warden/src/rules/`,
 * a nonexistent directory — silently defeating the rule).
 *
 * Exported for unit testing. Not part of the public rule API.
 */
export const replaceLastDistSegmentWithSrc = (path: string): string => {
  const distSegment = `${sep}dist${sep}`;
  const srcSegment = `${sep}src${sep}`;
  const lastIdx = path.lastIndexOf(distSegment);
  if (lastIdx === -1) {
    return path;
  }
  return (
    path.slice(0, lastIdx) +
    srcSegment +
    path.slice(lastIdx + distSegment.length)
  );
};

const SELF_RULES_DIRS: ReadonlySet<string> = new Set(
  SELF_MODULE_DIR.includes(`${sep}dist${sep}`)
    ? [SELF_MODULE_DIR, replaceLastDistSegmentWithSrc(SELF_MODULE_DIR)]
    : [SELF_MODULE_DIR]
);

/**
 * Stems of files in `src/rules/` (and their bundled `dist/rules/` twins) that
 * are NOT themselves warden rules and therefore must not be checked. `ast` is
 * the raw-text interface to the parser and legitimately touches source text;
 * the others are support modules without a `check()` function.
 */
const EXCLUDED_STEMS: readonly string[] = [
  'ast',
  'index',
  'registry-names',
  'scan',
  'specs',
  'structure',
  'types',
];

/**
 * Both `.ts` (source layout) and `.js` (dist layout) basenames must be
 * excluded so the rule stays silent when pointed at a bundled tree. The
 * dist-layout `ast.js` contains the same raw-text parser entry point as
 * `ast.ts` and would false-positive if scanned.
 */
const EXCLUDED_BASENAMES: ReadonlySet<string> = new Set(
  EXCLUDED_STEMS.flatMap((stem) => [`${stem}.ts`, `${stem}.js`])
);

const isTargetFile = (filePath: string): boolean => {
  const absolute = resolve(filePath);
  if (!SELF_RULES_DIRS.has(dirname(absolute))) {
    return false;
  }
  const basename = pathBasename(absolute);
  if (EXCLUDED_BASENAMES.has(basename)) {
    return false;
  }
  if (basename.endsWith('.test.ts') || basename.endsWith('.test.js')) {
    return false;
  }
  return true;
};

/**
 * Names of the WardenRule methods that receive raw source text as their
 * first parameter. The first parameter's *actual binding name* (not a fixed
 * list of names) is what we track via scope analysis — see `buildSourceParamIndex`.
 *
 * `checkTopo` does not receive raw source text (it takes a `Topo`) so it is
 * intentionally excluded.
 */
const SOURCE_PARAM_METHOD_NAMES: ReadonlySet<string> = new Set([
  'check',
  'checkWithContext',
]);

/**
 * String methods that indicate raw-text *scanning* when called on a
 * source-text identifier. Deliberately narrow: these are the patterns that
 * produce false positives on string literals, template payloads, and
 * docstrings — the regression TRL-333/TRL-334/TRL-335 fixed.
 *
 * Not flagged: `.slice`, `.substring`, `.indexOf`, `.includes`. These also
 * take source text as input, but have legitimate AST-adjacent uses — e.g.
 * `sourceCode.slice(node.start, node.end)` to recover a node's original
 * text from an AST-resolved range, or `sourceCode.includes('marker')` as a
 * fast-bail check before parsing. Flagging them would produce false
 * positives on idiomatic rules.
 */
const RAW_SCAN_METHODS: ReadonlySet<string> = new Set([
  'match',
  'matchAll',
  'replace',
  'replaceAll',
  'search',
  'split',
]);

/**
 * Methods on a regex receiver that consume a raw-text argument. Flagged
 * when the argument is a raw-source identifier (`sourceCode`, `text`, etc.).
 */
const REGEX_SCAN_METHODS: ReadonlySet<string> = new Set(['exec', 'test']);

const getIdentifierName = (node: AstNode | undefined): string | null => {
  if (!node || node.type !== 'Identifier') {
    return null;
  }
  const { name } = node as unknown as { name?: string };
  return typeof name === 'string' ? name : null;
};

/**
 * Scope-based source-param resolution. Each detector returns the
 * candidate `Identifier` AST node that must resolve to the enclosing
 * `check` / `checkWithContext` method's first parameter binding — i.e.
 * not shadowed by any intervening `const`/`let`/`var`/param declaration.
 * See `resolvesToSourceParam` for the walk.
 */
interface RawScanSite {
  readonly methodName: string;
  readonly identifier: AstNode;
  readonly identifierName: string;
  readonly start: number;
}

interface MemberCallParts {
  readonly object: AstNode | undefined;
  readonly property: AstNode | undefined;
}

/**
 * Extract the `object`/`property` of a non-computed member call, or null
 * for anything else. Keeps `rawScanSite` under the max-statements budget.
 */
const memberCallParts = (node: AstNode): MemberCallParts | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const { callee } = node as unknown as { callee?: AstNode };
  if (
    !callee ||
    (callee.type !== 'MemberExpression' &&
      callee.type !== 'StaticMemberExpression')
  ) {
    return null;
  }
  const { object, property, computed } = callee as unknown as {
    object?: AstNode;
    property?: AstNode;
    computed?: boolean;
  };
  return computed ? null : { object, property };
};

const rawScanSite = (node: AstNode): RawScanSite | null => {
  const parts = memberCallParts(node);
  if (!parts || !parts.object) {
    return null;
  }
  const receiver = getIdentifierName(parts.object);
  if (!receiver) {
    return null;
  }
  const methodName = getIdentifierName(parts.property);
  if (!methodName || !RAW_SCAN_METHODS.has(methodName)) {
    return null;
  }
  return {
    identifier: parts.object,
    identifierName: receiver,
    methodName,
    start: node.start,
  };
};

/**
 * True when `node` is a regex-producing expression: a regex literal
 * (`/foo/`), `new RegExp(...)`, or a plain `RegExp(...)` call.
 */
const isRegexProducer = (node: AstNode | undefined): boolean => {
  if (!node) {
    return false;
  }
  if (node.type === 'Literal' && 'regex' in node && node['regex']) {
    return true;
  }
  if (node.type === 'RegExpLiteral') {
    return true;
  }
  if (node.type === 'NewExpression' || node.type === 'CallExpression') {
    const { callee } = node as unknown as { callee?: AstNode };
    return getIdentifierName(callee) === 'RegExp';
  }
  return false;
};

/**
 * First identifier argument of a call expression, or null. The returned
 * identifier must still resolve to a tracked source-param binding (see
 * `resolvesToSourceParam`) before a diagnostic is emitted — this pre-filter
 * only narrows the candidate arg.
 */
const firstIdentifierArgument = (
  node: AstNode
): { identifier: AstNode; name: string } | null => {
  const args = (node as unknown as { arguments?: readonly AstNode[] })
    .arguments;
  if (!args) {
    return null;
  }
  for (const arg of args) {
    const name = getIdentifierName(arg);
    if (name) {
      return { identifier: arg, name };
    }
  }
  return null;
};

const regexScanMethodName = (parts: MemberCallParts): string | null => {
  if (!isRegexProducer(parts.object)) {
    return null;
  }
  const methodName = getIdentifierName(parts.property);
  if (!methodName || !REGEX_SCAN_METHODS.has(methodName)) {
    return null;
  }
  return methodName;
};

/**
 * Detects `/regex/.test(sourceCode)`, `new RegExp(...).exec(text)`, and
 * similar regex-receiver calls that consume a raw-source identifier.
 */
const regexScanSite = (node: AstNode): RawScanSite | null => {
  const parts = memberCallParts(node);
  if (!parts) {
    return null;
  }
  const methodName = regexScanMethodName(parts);
  if (!methodName) {
    return null;
  }
  const arg = firstIdentifierArgument(node);
  if (!arg) {
    return null;
  }
  return {
    identifier: arg.identifier,
    identifierName: arg.name,
    methodName,
    start: node.start,
  };
};

interface RegexConstructionSite {
  readonly kind: 'new' | 'call';
  readonly identifier: AstNode;
  readonly identifierName: string;
  readonly start: number;
}

/**
 * Detects `new RegExp(sourceCode)` / `RegExp(rawText, 'g')` — constructing a
 * regex from raw source text. Same anti-pattern family as
 * `sourceCode.match(...)` and `/re/.test(sourceCode)`: raw source fed into a
 * scanner. Fires when the callee is an `Identifier` named `RegExp` and at
 * least one argument is an identifier that resolves, via scope analysis, to
 * the enclosing `check` / `checkWithContext` method's first parameter.
 */
const regexConstructionSite = (node: AstNode): RegexConstructionSite | null => {
  if (node.type !== 'NewExpression' && node.type !== 'CallExpression') {
    return null;
  }
  const { callee } = node as unknown as { callee?: AstNode };
  if (getIdentifierName(callee) !== 'RegExp') {
    return null;
  }
  const arg = firstIdentifierArgument(node);
  if (!arg) {
    return null;
  }
  return {
    identifier: arg.identifier,
    identifierName: arg.name,
    kind: node.type === 'NewExpression' ? 'new' : 'call',
    start: node.start,
  };
};

const DIAGNOSTIC_ADVICE =
  'Warden rules must inspect the AST via packages/warden/src/rules/ast.ts helpers, not regex-scan raw source text. ' +
  'Use findStringLiterals, findTrailDefinitions, findConfigProperty, or a similar AST walker. ' +
  'Raw-text scanning produces false positives on string literals, template payloads, and docstrings — see TRL-335, ADR-0036.';

interface DetectedSite {
  readonly identifier: AstNode;
  readonly message: string;
  readonly start: number;
}

const detectRawScan = (node: AstNode): DetectedSite | null => {
  const scan = rawScanSite(node);
  if (!scan) {
    return null;
  }
  return {
    identifier: scan.identifier,
    message: `${RULE_NAME}: ${scan.identifierName}.${scan.methodName}(...) treats source text as a string. ${DIAGNOSTIC_ADVICE}`,
    start: scan.start,
  };
};

const detectRegexScan = (node: AstNode): DetectedSite | null => {
  const regex = regexScanSite(node);
  if (!regex) {
    return null;
  }
  return {
    identifier: regex.identifier,
    message: `${RULE_NAME}: regex.${regex.methodName}(${regex.identifierName}) scans raw source text. ${DIAGNOSTIC_ADVICE}`,
    start: regex.start,
  };
};

const detectRegexConstruction = (node: AstNode): DetectedSite | null => {
  const construction = regexConstructionSite(node);
  if (!construction) {
    return null;
  }
  const prefix = construction.kind === 'new' ? 'new RegExp' : 'RegExp';
  return {
    identifier: construction.identifier,
    message: `${RULE_NAME}: ${prefix}(${construction.identifierName}) constructs a regex from raw source text. ${DIAGNOSTIC_ADVICE}`,
    start: construction.start,
  };
};

/**
 * Dispatch chain for per-node detectors. Each detector tries one family in
 * priority order. First match wins; descent into children still happens so
 * nested offenses (e.g. a regex scan inside a callback passed to a raw-text
 * scan) are still caught.
 */
const DETECTORS: readonly ((node: AstNode) => DetectedSite | null)[] = [
  detectRawScan,
  detectRegexScan,
  detectRegexConstruction,
];

const detectSite = (node: AstNode): DetectedSite | null => {
  for (const detector of DETECTORS) {
    const site = detector(node);
    if (site) {
      return site;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Scope analysis (Option A — parameter-origin tracking).
//
// The pre-TRL-346 detectors gated on identifier spelling alone (a fixed set
// like `sourceCode`, `text`, `source`, `rawText`). That over-fires on
// unrelated locals that happen to share one of those names, and under-fires
// when a rule author picks a different name for the source parameter.
//
// Option A walks the AST with a scope stack, records the first parameter of
// any `check` / `checkWithContext` method (its *actual binding name*), and
// only flags a call site when the candidate identifier still refers to that
// exact binding — i.e. no intervening `const`/`let`/`var`/param has
// shadowed it.
// ---------------------------------------------------------------------------

interface Scope {
  readonly declaredNames: Set<string>;
  readonly sourceParamName: string | null;
}

/**
 * Walk inner→outer. The first scope that declares `name` is the binding; the
 * identifier resolves to a tracked source-param only when that declaring
 * scope's `sourceParamName` matches. An identifier with no declaring scope
 * (e.g. a free variable) is not a source-param binding.
 */
const resolvesToSourceParam = (
  name: string,
  scopes: readonly Scope[]
): boolean => {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const scope = scopes[i];
    if (scope && scope.declaredNames.has(name)) {
      return scope.sourceParamName === name;
    }
  }
  return false;
};

const FUNCTION_NODE_TYPES: ReadonlySet<string> = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]);

/**
 * Name of a function-like node when it is a recognized WardenRule method
 * (`check` or `checkWithContext`). Returns null otherwise.
 *
 * Handles three shapes:
 *   - object-literal method shorthand: `{ check(sc) { ... } }`
 *     (Property with `method: true`, or MethodDefinition)
 *   - arrow/function property: `{ check: (sc) => { ... } }`
 *   - top-level function declaration: `function check(sc) { ... }`
 *
 * The context-to-function link is resolved by the caller via the
 * `methodFunctionStarts` map: we pre-walk the AST once to map the start
 * offset of every recognized function to its method name, then consult the
 * map when the scope walker enters that function.
 */
const methodNameFromKey = (key: AstNode | undefined): string | null => {
  if (!key) {
    return null;
  }
  if (key.type === 'Identifier') {
    return (key as unknown as { name?: string }).name ?? null;
  }
  // String-literal keys like `'check': (sc) => { ... }`.
  if (
    (key.type === 'Literal' || key.type === 'StringLiteral') &&
    typeof (key as unknown as { value?: unknown }).value === 'string'
  ) {
    return (key as unknown as { value: string }).value;
  }
  return null;
};

const firstParamIdentifierName = (fn: AstNode): string | null => {
  const { params } = fn as unknown as { params?: readonly AstNode[] };
  const [first] = params ?? [];
  if (!first) {
    return null;
  }
  if (first.type === 'Identifier') {
    return getIdentifierName(first);
  }
  if (first.type === 'AssignmentPattern') {
    const { left } = first as unknown as { left?: AstNode };
    return left?.type === 'Identifier' ? getIdentifierName(left) : null;
  }
  return null;
};

/**
 * Collect start offsets of function-like AST nodes that represent the body
 * of a recognized WardenRule source-receiving method. Value is the declared
 * first-parameter name, used as `sourceParamName` when the scope walker
 * pushes that function's scope.
 */
const methodPropertyFunction = (
  node: AstNode
): { fn: AstNode; name: string } | null => {
  const { key, value } = node as unknown as {
    key?: AstNode;
    value?: AstNode;
  };
  const name = methodNameFromKey(key);
  if (!name || !value || !FUNCTION_NODE_TYPES.has(value.type)) {
    return null;
  }
  return SOURCE_PARAM_METHOD_NAMES.has(name) ? { fn: value, name } : null;
};

const namedFunctionDeclaration = (
  node: AstNode
): { fn: AstNode; name: string } | null => {
  const name = getIdentifierName((node as unknown as { id?: AstNode }).id);
  if (!name || !SOURCE_PARAM_METHOD_NAMES.has(name)) {
    return null;
  }
  return { fn: node, name };
};

const recognizedMethodFunction = (
  node: AstNode
): { fn: AstNode; name: string } | null => {
  if (node.type === 'Property' || node.type === 'MethodDefinition') {
    return methodPropertyFunction(node);
  }
  if (node.type === 'FunctionDeclaration') {
    return namedFunctionDeclaration(node);
  }
  return null;
};

const buildSourceParamIndex = (ast: AstNode): ReadonlyMap<number, string> => {
  const index = new Map<number, string>();
  walk(ast, (node) => {
    const recognized = recognizedMethodFunction(node);
    if (!recognized) {
      return;
    }
    const paramName = firstParamIdentifierName(recognized.fn);
    if (paramName) {
      index.set(recognized.fn.start, paramName);
    }
  });
  return index;
};

/**
 * Collect identifier names introduced at this scope by
 * `const`/`let`/`var`/function declarations or function params. We only
 * inspect direct children — nested block statements and nested functions
 * have their own scopes.
 */
const expandObjectPatternProperty = (property: AstNode): readonly AstNode[] => {
  if (property.type === 'Property') {
    const { value } = property as unknown as { value?: AstNode };
    return value ? [value] : [];
  }
  if (property.type === 'RestElement') {
    const { argument } = property as unknown as { argument?: AstNode };
    return argument ? [argument] : [];
  }
  return [];
};

const PATTERN_EXPANDERS: Record<string, (p: AstNode) => readonly AstNode[]> = {
  ArrayPattern: (pattern) => {
    const elements =
      (pattern as unknown as { elements?: readonly (AstNode | null)[] })
        .elements ?? [];
    return elements.filter((el): el is AstNode => el !== null);
  },
  AssignmentPattern: (pattern) => {
    const { left } = pattern as unknown as { left?: AstNode };
    return left ? [left] : [];
  },
  ObjectPattern: (pattern) => {
    const properties =
      (pattern as unknown as { properties?: readonly AstNode[] }).properties ??
      [];
    return properties.flatMap(expandObjectPatternProperty);
  },
  RestElement: (pattern) => {
    const { argument } = pattern as unknown as { argument?: AstNode };
    return argument ? [argument] : [];
  },
};

/**
 * Collect identifier names introduced by a binding pattern (function
 * parameter, destructuring target, etc.). Iterative worklist over
 * {@link PATTERN_EXPANDERS}: each expander yields one level of child
 * patterns, and the loop bottoms out at `Identifier` nodes. The iterative
 * shape avoids mutual recursion so every helper stays under the
 * `max-statements` budget.
 */
const visitPatternNode = (
  current: AstNode,
  into: Set<string>,
  worklist: AstNode[]
): void => {
  if (current.type === 'Identifier') {
    const name = getIdentifierName(current);
    if (name) {
      into.add(name);
    }
    return;
  }
  const expand = PATTERN_EXPANDERS[current.type];
  if (expand) {
    worklist.push(...expand(current));
  }
};

const collectBindingIdsFromPattern = (
  pattern: AstNode | undefined,
  into: Set<string>
): void => {
  if (!pattern) {
    return;
  }
  const worklist: AstNode[] = [pattern];
  while (worklist.length > 0) {
    const current = worklist.pop();
    if (current) {
      visitPatternNode(current, into, worklist);
    }
  }
};

const collectFunctionParamNames = (fn: AstNode): Set<string> => {
  const names = new Set<string>();
  const params =
    (fn as unknown as { params?: readonly AstNode[] }).params ?? [];
  for (const param of params) {
    collectBindingIdsFromPattern(param, names);
  }
  return names;
};

const addVariableDeclarationNames = (
  stmt: AstNode,
  names: Set<string>
): void => {
  const declarations =
    (stmt as unknown as { declarations?: readonly AstNode[] }).declarations ??
    [];
  for (const decl of declarations) {
    collectBindingIdsFromPattern(
      (decl as unknown as { id?: AstNode }).id,
      names
    );
  }
};

const addFunctionDeclarationName = (
  stmt: AstNode,
  names: Set<string>
): void => {
  const name = getIdentifierName((stmt as unknown as { id?: AstNode }).id);
  if (name) {
    names.add(name);
  }
};

const collectBlockDeclarationNames = (block: AstNode): Set<string> => {
  const names = new Set<string>();
  const body = (block as unknown as { body?: readonly AstNode[] }).body ?? [];
  for (const stmt of body) {
    if (stmt.type === 'VariableDeclaration') {
      addVariableDeclarationNames(stmt, names);
    } else if (stmt.type === 'FunctionDeclaration') {
      addFunctionDeclarationName(stmt, names);
    }
  }
  return names;
};

interface ScopeWalkContext {
  readonly diagnostics: WardenDiagnostic[];
  readonly filePath: string;
  readonly methodFunctionStarts: ReadonlyMap<number, string>;
  readonly sourceCode: string;
}

const recordDiagnostic = (ctx: ScopeWalkContext, site: DetectedSite): void => {
  ctx.diagnostics.push({
    filePath: ctx.filePath,
    line: offsetToLine(ctx.sourceCode, site.start),
    message: site.message,
    rule: RULE_NAME,
    severity: 'error' as const,
  });
};

/**
 * Emit a diagnostic if `node` is a detected site whose candidate identifier
 * resolves (via the current scope stack) to a tracked source-param binding.
 */
const maybeRecordDetection = (
  node: AstNode,
  scopes: readonly Scope[],
  ctx: ScopeWalkContext
): void => {
  const site = detectSite(node);
  if (!site) {
    return;
  }
  const name = getIdentifierName(site.identifier);
  if (name && resolvesToSourceParam(name, scopes)) {
    recordDiagnostic(ctx, site);
  }
};

/**
 * Push the scope a function node introduces, or null when the node is not
 * scope-introducing. Returning a dispose function keeps `visitWithScopes`
 * small and keeps the scope stack strictly paired.
 */
const enterScopeForNode = (
  node: AstNode,
  ctx: ScopeWalkContext,
  scopes: Scope[]
): boolean => {
  if (FUNCTION_NODE_TYPES.has(node.type)) {
    const sourceParamName = ctx.methodFunctionStarts.get(node.start) ?? null;
    scopes.push({
      declaredNames: collectFunctionParamNames(node),
      sourceParamName,
    });
    return true;
  }
  if (node.type === 'BlockStatement') {
    scopes.push({
      declaredNames: collectBlockDeclarationNames(node),
      sourceParamName: null,
    });
    return true;
  }
  return false;
};

interface EnterFrame {
  kind: 'enter';
  node: AstNode;
}
type WalkFrame = EnterFrame | { kind: 'leave'; pushed: boolean };

/**
 * Build "enter" frames for every AST child of `node`. Returned reversed so
 * consumers can `Array#push(...frames)` onto a stack and still visit
 * children in source order via `Array#pop`.
 */
const collectChildFrames = (node: AstNode): readonly EnterFrame[] => {
  const frames: EnterFrame[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && (item as AstNode).type) {
          frames.push({ kind: 'enter', node: item as AstNode });
        }
      }
      continue;
    }
    if (value && typeof value === 'object' && (value as AstNode).type) {
      frames.push({ kind: 'enter', node: value as AstNode });
    }
  }
  return frames.toReversed();
};

const processFrame = (
  frame: WalkFrame,
  scopes: Scope[],
  ctx: ScopeWalkContext,
  stack: WalkFrame[]
): void => {
  if (frame.kind === 'leave') {
    if (frame.pushed) {
      scopes.pop();
    }
    return;
  }
  const { node } = frame;
  maybeRecordDetection(node, scopes, ctx);
  const pushed = enterScopeForNode(node, ctx, scopes);
  stack.push({ kind: 'leave', pushed });
  stack.push(...collectChildFrames(node));
};

/**
 * Scope-aware AST walker. Iterative DFS: each enter frame schedules the
 * node's children in source order and queues a matching leave frame so
 * scope pops stay balanced with their pushes.
 */
const analyze = (
  sourceCode: string,
  filePath: string,
  ast: AstNode
): readonly WardenDiagnostic[] => {
  const ctx: ScopeWalkContext = {
    diagnostics: [],
    filePath,
    methodFunctionStarts: buildSourceParamIndex(ast),
    sourceCode,
  };
  const scopes: Scope[] = [];
  const stack: WalkFrame[] = [{ kind: 'enter', node: ast }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame) {
      processFrame(frame, scopes, ctx, stack);
    }
  }
  return ctx.diagnostics;
};

/**
 * Warden rule enforcing that warden rules themselves walk the AST rather than
 * regex-scan raw source text.
 */
export const wardenRulesUseAst: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (!isTargetFile(filePath)) {
      return [];
    }
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return analyze(sourceCode, filePath, ast);
  },
  description:
    'Enforces that warden rules inspect the AST via packages/warden/src/rules/ast.ts helpers rather than regex-scanning raw source text.',
  name: RULE_NAME,
  severity: 'error',
};
