/**
 * Finds implementations that return raw values instead of `Result`.
 *
 * Uses AST parsing to find `implementation:` bodies and check that
 * every return statement returns Result.ok(), Result.err(), ctx.follow(),
 * or a tracked Result-typed variable.
 */

import {
  findImplementationBodies,
  findTrailDefinitions,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Member expression helpers
// ---------------------------------------------------------------------------

/** Extract object.property names from a MemberExpression callee. */
const extractMemberNames = (
  callee: AstNode
): { objName: string | undefined; propName: string | undefined } => {
  const obj = (callee as unknown as { object?: AstNode }).object;
  const prop = (callee as unknown as { property?: AstNode }).property;
  const objName =
    obj?.type === 'Identifier'
      ? (obj as unknown as { name: string }).name
      : undefined;
  const propName =
    prop?.type === 'Identifier'
      ? (prop as unknown as { name: string }).name
      : undefined;
  return { objName, propName };
};

const isMemberExpression = (callee: AstNode): boolean =>
  callee.type === 'StaticMemberExpression' ||
  callee.type === 'MemberExpression';

const isResultMemberCall = (callee: AstNode): boolean => {
  if (!isMemberExpression(callee)) {
    return false;
  }
  const { objName, propName } = extractMemberNames(callee);
  if (objName === 'Result' && (propName === 'ok' || propName === 'err')) {
    return true;
  }
  if (objName === 'ctx' && propName === 'follow') {
    return true;
  }
  return propName === 'implementation';
};

// ---------------------------------------------------------------------------
// Expression classification
// ---------------------------------------------------------------------------

/** Check if an expression node is an allowed Result-returning expression. */
const isResultExpression = (node: AstNode): boolean => {
  if (node.type === 'CallExpression') {
    const callee = node['callee'] as AstNode | undefined;
    if (!callee) {
      return false;
    }
    return isResultMemberCall(callee);
  }

  if (node.type === 'AwaitExpression') {
    const arg = (node as unknown as { argument?: AstNode }).argument;
    return arg ? isResultExpression(arg) : false;
  }

  return false;
};

/** Check if a node is a call to a known Result-returning helper. */
const isHelperCall = (
  node: AstNode,
  helperNames: ReadonlySet<string>
): boolean => {
  const target =
    node.type === 'AwaitExpression'
      ? ((node as unknown as { argument?: AstNode }).argument ?? null)
      : node;

  if (!target || target.type !== 'CallExpression') {
    return false;
  }

  const callee = target['callee'] as AstNode | undefined;
  if (callee?.type === 'Identifier') {
    const { name } = callee as unknown as { name: string };
    return helperNames.has(name);
  }

  return false;
};

/** Unwrap an optional AwaitExpression to get the inner identifier name. */
const resolveIdentifierName = (node: AstNode): string | null => {
  if (node.type === 'Identifier') {
    return (node as unknown as { name: string }).name;
  }
  if (node.type === 'AwaitExpression') {
    const inner = (node as unknown as { argument?: AstNode }).argument;
    if (inner?.type === 'Identifier') {
      return (inner as unknown as { name: string }).name;
    }
  }
  return null;
};

/** Check if a return argument is an allowed Result value. */
const isAllowedReturnArgument = (
  argument: AstNode,
  helperNames: ReadonlySet<string>,
  resultVars: ReadonlySet<string>
): boolean => {
  if (isResultExpression(argument)) {
    return true;
  }
  if (isHelperCall(argument, helperNames)) {
    return true;
  }

  const varName = resolveIdentifierName(argument);
  return varName !== null && resultVars.has(varName);
};

// ---------------------------------------------------------------------------
// Variable tracking
// ---------------------------------------------------------------------------

/** Track a VariableDeclarator, adding to resultVars if it produces a Result. */
const trackResultVariable = (node: AstNode, resultVars: Set<string>): void => {
  const { init } = node as unknown as { init?: AstNode };
  const { id } = node as unknown as { id?: AstNode };
  if (init && id?.type === 'Identifier') {
    const { name } = id as unknown as { name: string };
    if (isResultExpression(init)) {
      resultVars.add(name);
    }
  }
};

// ---------------------------------------------------------------------------
// Shallow walk (stops at nested function boundaries)
// ---------------------------------------------------------------------------

const FUNCTION_BOUNDARY_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
]);

/** Check if a value is a function-boundary AST node that should not be recursed into. */
const isFunctionBoundary = (val: unknown): boolean =>
  !!val &&
  typeof val === 'object' &&
  FUNCTION_BOUNDARY_TYPES.has((val as AstNode).type);

/** Recurse into a single AST property value, skipping function boundaries. */
const visitValue = (
  val: unknown,
  visit: (node: AstNode) => void,
  recurse: (node: unknown, visit: (node: AstNode) => void) => void
): void => {
  if (Array.isArray(val)) {
    for (const item of val) {
      if (!isFunctionBoundary(item)) {
        recurse(item, visit);
      }
    }
  } else if (
    val &&
    typeof val === 'object' &&
    (val as AstNode).type &&
    !isFunctionBoundary(val)
  ) {
    recurse(val, visit);
  }
};

/**
 * Walk an AST node tree without recursing into nested function bodies.
 *
 * This ensures that return statements inside `.map()`, `.filter()`, `.then()`
 * callbacks etc. are not mistakenly checked as implementation-level returns.
 */
const walkShallow = (node: unknown, visit: (node: AstNode) => void): void => {
  if (!node || typeof node !== 'object') {
    return;
  }
  const n = node as AstNode;
  if (n.type) {
    visit(n);
  }
  for (const val of Object.values(n)) {
    visitValue(val, visit, walkShallow);
  }
};

// ---------------------------------------------------------------------------
// Return statement checking
// ---------------------------------------------------------------------------

/** Check return statements in a block body for non-Result returns. */
const checkReturnStatements = (
  blockBody: AstNode,
  trailInfo: { id: string; label: string },
  filePath: string,
  sourceCode: string,
  helperNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const resultVars = new Set<string>();

  walkShallow(blockBody, (node) => {
    if (node.type === 'VariableDeclarator') {
      trackResultVariable(node, resultVars);
    }

    if (node.type !== 'ReturnStatement') {
      return;
    }

    const { argument } = node as unknown as { argument?: AstNode };
    // Bare return — not a value return
    if (!argument) {
      return;
    }

    if (isAllowedReturnArgument(argument, helperNames, resultVars)) {
      return;
    }

    diagnostics.push({
      filePath,
      line: offsetToLine(sourceCode, node.start),
      message: `${trailInfo.label} "${trailInfo.id}" implementation must return Result.ok(...) or Result.err(...), not a raw value.`,
      rule: 'implementation-returns-result',
      severity: 'error',
    });
  });
};

// ---------------------------------------------------------------------------
// Result helper name collection
// ---------------------------------------------------------------------------

/** Check if a return type annotation mentions Result. */
const hasResultReturnType = (node: AstNode, sourceCode: string): boolean => {
  const { returnType } = node as unknown as { returnType?: AstNode };
  if (!returnType) {
    return false;
  }
  const annotationText = sourceCode.slice(returnType.start, returnType.end);
  return /\bResult\s*</.test(annotationText);
};

const isFunctionLikeExpression = (node: AstNode): boolean =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';

/** Collect names of top-level functions/consts with explicit Result return types. */
const collectResultHelperNames = (
  ast: AstNode,
  sourceCode: string
): ReadonlySet<string> => {
  const names = new Set<string>();

  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator') {
      const { id } = node as unknown as { id?: AstNode };
      const { init } = node as unknown as { init?: AstNode };
      if (
        id?.type === 'Identifier' &&
        init &&
        isFunctionLikeExpression(init) &&
        hasResultReturnType(init, sourceCode)
      ) {
        names.add((id as unknown as { name: string }).name);
      }
    }

    if (node.type === 'FunctionDeclaration') {
      const { id } = node as unknown as { id?: AstNode };
      if (id?.type === 'Identifier' && hasResultReturnType(node, sourceCode)) {
        names.add((id as unknown as { name: string }).name);
      }
    }
  });

  return names;
};

// ---------------------------------------------------------------------------
// Per-implementation checking
// ---------------------------------------------------------------------------

const checkImplementation = (
  implValue: AstNode,
  info: { id: string; label: string },
  filePath: string,
  sourceCode: string,
  helperNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const fnBody = (implValue as unknown as { body?: AstNode }).body;
  if (!fnBody) {
    return;
  }

  if (fnBody.type === 'BlockStatement' || fnBody.type === 'FunctionBody') {
    checkReturnStatements(
      fnBody,
      info,
      filePath,
      sourceCode,
      helperNames,
      diagnostics
    );
    return;
  }

  if (!isResultExpression(fnBody) && !isHelperCall(fnBody, helperNames)) {
    diagnostics.push({
      filePath,
      line: offsetToLine(sourceCode, implValue.start),
      message: `${info.label} "${info.id}" implementation must return Result.ok(...) or Result.err(...), not a raw value.`,
      rule: 'implementation-returns-result',
      severity: 'error',
    });
  }
};

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

const checkAllDefinitions = (
  ast: AstNode,
  filePath: string,
  sourceCode: string
): WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const helperNames = collectResultHelperNames(ast, sourceCode);

  for (const def of findTrailDefinitions(ast)) {
    const info = { id: def.id, label: def.kind === 'hike' ? 'Hike' : 'Trail' };
    for (const implValue of findImplementationBodies(def.config as AstNode)) {
      checkImplementation(
        implValue,
        info,
        filePath,
        sourceCode,
        helperNames,
        diagnostics
      );
    }
  }

  return diagnostics;
};

/**
 * Finds implementations that return raw values instead of `Result`.
 */
export const implementationReturnsResult: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return checkAllDefinitions(ast as AstNode, filePath, sourceCode);
  },
  description:
    'Disallow implementations that return raw values instead of Result.ok() or Result.err().',
  name: 'implementation-returns-result',
  severity: 'error',
};
