import {
  findConfigProperty,
  findTrailDefinitions,
  identifierName,
  offsetToLine,
  parse,
  walk,
  walkScope,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const TRANSPARENT_WRAPPER_TYPES = new Set([
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);

const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]);

const unwrapExpression = (node: AstNode | undefined): AstNode | undefined => {
  let current = node;
  while (current && TRANSPARENT_WRAPPER_TYPES.has(current.type)) {
    current = current['expression'] as AstNode | undefined;
  }
  return current;
};

const getDetourElements = (config: AstNode): readonly (AstNode | null)[] => {
  const detoursProp = findConfigProperty(config, 'detours');
  if (!detoursProp) {
    return [];
  }

  const detoursValue = unwrapExpression(
    detoursProp.value as AstNode | undefined
  );
  if (!detoursValue || detoursValue.type !== 'ArrayExpression') {
    return [];
  }

  return (
    ((detoursValue as AstNode)['elements'] as readonly (AstNode | null)[]) ?? []
  );
};

const getFunctionBody = (node: AstNode | undefined): AstNode | undefined => {
  if (!node || !FUNCTION_TYPES.has(node.type)) {
    return undefined;
  }

  const { body } = node;
  return Array.isArray(body) ? undefined : (body as AstNode | undefined);
};

interface RecoverBodyMatch {
  readonly index: number;
  readonly trailId: string;
  readonly body: AstNode;
}

const collectFunctionRecoverBinding = (
  bindings: Map<string, AstNode>,
  node: AstNode
): boolean => {
  if (node.type !== 'FunctionDeclaration') {
    return false;
  }

  const name = identifierName(node['id'] as AstNode | undefined);
  if (name) {
    bindings.set(name, node);
  }
  return true;
};

const collectVariableRecoverBinding = (
  bindings: Map<string, AstNode>,
  node: AstNode
): void => {
  if (node.type !== 'VariableDeclarator') {
    return;
  }

  const name = identifierName(node['id'] as AstNode | undefined);
  const init = unwrapExpression(node['init'] as AstNode | undefined);
  if (!name || !init || !FUNCTION_TYPES.has(init.type)) {
    return;
  }

  bindings.set(name, init);
};

const collectRecoverBinding = (
  bindings: Map<string, AstNode>,
  node: AstNode
): void => {
  if (collectFunctionRecoverBinding(bindings, node)) {
    return;
  }

  collectVariableRecoverBinding(bindings, node);
};

const collectRecoverBindings = (ast: AstNode): ReadonlyMap<string, AstNode> => {
  const bindings = new Map<string, AstNode>();

  walk(ast, (node) => {
    collectRecoverBinding(bindings, node);
  });

  return bindings;
};

const resolveRecoverBody = (
  node: AstNode | undefined,
  bindings: ReadonlyMap<string, AstNode>
): AstNode | undefined => {
  const unwrapped = unwrapExpression(node);
  if (!unwrapped) {
    return undefined;
  }

  const inlineBody = getFunctionBody(unwrapped);
  if (inlineBody) {
    return inlineBody;
  }

  const bindingName = identifierName(unwrapped);
  if (!bindingName) {
    return undefined;
  }

  return getFunctionBody(bindings.get(bindingName));
};

const resolveRecoverBodyFromElement = (
  element: AstNode | null,
  bindings: ReadonlyMap<string, AstNode>
): AstNode | undefined => {
  if (!element || element.type !== 'ObjectExpression') {
    return undefined;
  }

  const recoverProp = findConfigProperty(element, 'recover');
  return resolveRecoverBody(
    recoverProp?.value as AstNode | undefined,
    bindings
  );
};

const appendRecoverBodies = (
  bodies: RecoverBodyMatch[],
  definition: { readonly config: AstNode; readonly id: string },
  bindings: ReadonlyMap<string, AstNode>
): void => {
  const detourElements = getDetourElements(definition.config);
  for (const [index, element] of detourElements.entries()) {
    const body = resolveRecoverBodyFromElement(element, bindings);
    if (!body) {
      continue;
    }

    bodies.push({ body, index, trailId: definition.id });
  }
};

const findRecoverBodies = (ast: AstNode): readonly RecoverBodyMatch[] => {
  const bindings = collectRecoverBindings(ast);
  const bodies: RecoverBodyMatch[] = [];

  for (const definition of findTrailDefinitions(ast)) {
    if (definition.kind !== 'trail') {
      continue;
    }

    appendRecoverBodies(bodies, definition, bindings);
  }

  return bodies;
};

export const noThrowInDetourRecover: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];

    for (const recover of findRecoverBodies(ast)) {
      walkScope(recover.body, (node) => {
        if (node.type !== 'ThrowStatement') {
          return;
        }

        diagnostics.push({
          filePath,
          line: offsetToLine(sourceCode, node.start),
          message: `Trail "${recover.trailId}" detour[${recover.index}] recover must not throw. Return Result.err() instead.`,
          rule: 'no-throw-in-detour-recover',
          severity: 'error',
        });
      });
    }

    return diagnostics;
  },
  description:
    'Disallow throw statements inside detour recover functions. Use Result.err() instead.',
  name: 'no-throw-in-detour-recover',
  severity: 'error',
};
