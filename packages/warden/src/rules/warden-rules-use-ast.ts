/**
 * Self-governance rule: warden rules must inspect the AST via the helpers in
 * `./ast.ts` rather than regex-scanning raw source text. Raw-text scans
 * produce false positives on string literals, template payloads, and
 * docstrings — see TRL-335 and ADR-0036.
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
 * Identifier names that, when used as the receiver of a string method call,
 * signal raw source-text scanning. Kept intentionally narrow so legitimate
 * helpers operating on domain strings are not flagged.
 */
const RAW_SOURCE_IDENTIFIERS: ReadonlySet<string> = new Set([
  'rawText',
  'source',
  'sourceCode',
  'text',
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

interface RawScanSite {
  readonly methodName: string;
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
  if (!parts) {
    return null;
  }
  const receiver = getIdentifierName(parts.object);
  if (!receiver || !RAW_SOURCE_IDENTIFIERS.has(receiver)) {
    return null;
  }
  const methodName = getIdentifierName(parts.property);
  if (!methodName || !RAW_SCAN_METHODS.has(methodName)) {
    return null;
  }
  return { identifierName: receiver, methodName, start: node.start };
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
 * First raw-source identifier among a call expression's arguments, or null.
 */
const rawTextArgumentName = (node: AstNode): string | null => {
  const args = (node as unknown as { arguments?: readonly AstNode[] })
    .arguments;
  if (!args) {
    return null;
  }
  for (const arg of args) {
    const name = getIdentifierName(arg);
    if (name && RAW_SOURCE_IDENTIFIERS.has(name)) {
      return name;
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
  const argName = rawTextArgumentName(node);
  if (!argName) {
    return null;
  }
  return { identifierName: argName, methodName, start: node.start };
};

const DIAGNOSTIC_ADVICE =
  'Warden rules must inspect the AST via packages/warden/src/rules/ast.ts helpers, not regex-scan raw source text. ' +
  'Use findStringLiterals, findTrailDefinitions, findConfigProperty, or a similar AST walker. ' +
  'Raw-text scanning produces false positives on string literals, template payloads, and docstrings — see TRL-335, ADR-0036.';

const analyze = (
  sourceCode: string,
  filePath: string,
  ast: AstNode
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  walk(ast, (node) => {
    const scan = rawScanSite(node);
    if (scan) {
      diagnostics.push({
        filePath,
        line: offsetToLine(sourceCode, scan.start),
        message: `${RULE_NAME}: ${scan.identifierName}.${scan.methodName}(...) treats source text as a string. ${DIAGNOSTIC_ADVICE}`,
        rule: RULE_NAME,
        severity: 'error' as const,
      });
      // Guard against double-firing on this node; walk() still descends into
      // children to catch nested raw scans (e.g. a regex scan inside a
      // callback passed to a raw-text scan).
      return;
    }
    const regex = regexScanSite(node);
    if (regex) {
      diagnostics.push({
        filePath,
        line: offsetToLine(sourceCode, regex.start),
        message: `${RULE_NAME}: regex.${regex.methodName}(${regex.identifierName}) scans raw source text. ${DIAGNOSTIC_ADVICE}`,
        rule: RULE_NAME,
        severity: 'error' as const,
      });
    }
  });
  return diagnostics;
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
