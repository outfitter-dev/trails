import {
  collectScopeFrameBindings,
  findBlazeBodies,
  findTrailDefinitions,
  getMemberExpression,
  identifierName,
  isMemberAccessNonComputed,
  offsetToLine,
  parse,
  walkWithScopes,
} from './ast.js';
import {
  collectAllResultHelperNames,
  collectNamespaceHelperImports,
  collectResultTypeNames,
  findNearestBindingScope,
  isHelperCall,
  isResultExpression,
  trackScopedResultHelperDeclaration,
} from './implementation-returns-result.js';
import { isTestFile } from './scan.js';
import type { AstNode } from './ast.js';
import type {
  MutableScopedHelperMap,
  NamespaceHelperMap,
  ScopedHelperMap,
} from './implementation-returns-result.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'no-redundant-result-error-wrap';

const getStaticMemberName = (node: AstNode | undefined): string | null => {
  if (!node || !isMemberAccessNonComputed(node)) {
    return null;
  }
  return identifierName((node as unknown as { property?: AstNode }).property);
};

const isResultObject = (node: AstNode | undefined): boolean => {
  if (!node) {
    return false;
  }
  if (identifierName(node) === 'Result') {
    return true;
  }
  return getStaticMemberName(node) === 'Result';
};

const isResultErrCall = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const { callee } = node as unknown as { callee?: AstNode };
  const member = getMemberExpression(callee);
  if (!member || getStaticMemberName(callee) !== 'err') {
    return false;
  }
  return isResultObject(member.object);
};

const getSingleArgument = (node: AstNode): AstNode | null => {
  const args = (node as unknown as { arguments?: readonly AstNode[] })
    .arguments;
  return args?.length === 1 ? (args[0] ?? null) : null;
};

const getErrorSourceVariable = (node: AstNode | null): string | null => {
  if (!node || getStaticMemberName(node) !== 'error') {
    return null;
  }
  const member = getMemberExpression(node);
  return identifierName(member?.object);
};

const isResultProducingExpression = (
  node: AstNode,
  helperNames: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap,
  scopes: readonly ReadonlySet<string>[],
  scopedHelpers: ScopedHelperMap
): boolean =>
  isResultExpression(node) ||
  isHelperCall(node, helperNames, namespaceHelpers, scopes, scopedHelpers);

type ResultProvenance = Map<ReadonlySet<string>, Set<string>>;

const markResultVariable = (
  provenance: ResultProvenance,
  scope: ReadonlySet<string>,
  name: string
): void => {
  const names = provenance.get(scope);
  if (names) {
    names.add(name);
    return;
  }
  provenance.set(scope, new Set([name]));
};

const clearResultVariable = (
  provenance: ResultProvenance,
  scope: ReadonlySet<string>,
  name: string
): void => {
  provenance.get(scope)?.delete(name);
};

const hasResultProvenance = (
  provenance: ResultProvenance,
  scope: ReadonlySet<string>,
  name: string
): boolean => provenance.get(scope)?.has(name) ?? false;

const createDiagnostic = (
  filePath: string,
  sourceCode: string,
  node: AstNode,
  trailId: string,
  variableName: string
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, node.start),
  message: `Trail "${trailId}": Result.err(${variableName}.error) re-wraps a Result that already carries that error. Return ${variableName} directly to preserve the original Result boundary.`,
  rule: RULE_NAME,
  severity: 'warn',
});

const trackVariableDeclarator = (
  node: AstNode,
  provenance: ResultProvenance,
  helperNames: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap,
  scopedHelpers: ScopedHelperMap,
  scopes: readonly ReadonlySet<string>[]
): void => {
  const { id, init } = node as unknown as { id?: AstNode; init?: AstNode };
  const name = identifierName(id);
  if (!name) {
    return;
  }
  const scope = findNearestBindingScope(name, scopes);
  if (!scope) {
    return;
  }
  if (
    init &&
    isResultProducingExpression(
      init,
      helperNames,
      namespaceHelpers,
      scopes,
      scopedHelpers
    )
  ) {
    markResultVariable(provenance, scope, name);
    return;
  }
  clearResultVariable(provenance, scope, name);
};

const trackAssignmentExpression = (
  node: AstNode,
  provenance: ResultProvenance,
  helperNames: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap,
  scopedHelpers: ScopedHelperMap,
  scopes: readonly ReadonlySet<string>[]
): void => {
  const { left, operator, right } = node as unknown as {
    left?: AstNode;
    operator?: string;
    right?: AstNode;
  };
  const name = identifierName(left);
  if (!name) {
    return;
  }
  const scope = findNearestBindingScope(name, scopes);
  if (!scope) {
    return;
  }
  if (
    operator === '=' &&
    right &&
    isResultProducingExpression(
      right,
      helperNames,
      namespaceHelpers,
      scopes,
      scopedHelpers
    )
  ) {
    markResultVariable(provenance, scope, name);
    return;
  }
  clearResultVariable(provenance, scope, name);
};

const checkReturnStatement = (
  node: AstNode,
  provenance: ResultProvenance,
  scopes: readonly ReadonlySet<string>[],
  filePath: string,
  sourceCode: string,
  trailId: string,
  diagnostics: WardenDiagnostic[]
): void => {
  const { argument } = node as unknown as { argument?: AstNode };
  if (!argument || !isResultErrCall(argument)) {
    return;
  }
  const variableName = getErrorSourceVariable(getSingleArgument(argument));
  if (!variableName) {
    return;
  }
  const scope = findNearestBindingScope(variableName, scopes);
  if (!scope || !hasResultProvenance(provenance, scope, variableName)) {
    return;
  }
  diagnostics.push(
    createDiagnostic(filePath, sourceCode, argument, trailId, variableName)
  );
};

const checkBlazeBody = (
  blaze: AstNode,
  trailId: string,
  filePath: string,
  sourceCode: string,
  helperNames: ReadonlySet<string>,
  namespaceHelpers: NamespaceHelperMap,
  resultTypeNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const { body } = blaze as unknown as { body?: AstNode };
  if (
    !body ||
    (body.type !== 'BlockStatement' && body.type !== 'FunctionBody')
  ) {
    return;
  }

  const provenance: ResultProvenance = new Map();
  const scopedHelpers: MutableScopedHelperMap = new Map();
  const implScope = collectScopeFrameBindings(blaze);
  const initialScopes = implScope.size > 0 ? [implScope] : [];

  walkWithScopes(
    body,
    (node, scopes) => {
      if (node.type === 'VariableDeclarator') {
        trackScopedResultHelperDeclaration(
          node,
          scopes,
          sourceCode,
          resultTypeNames,
          scopedHelpers
        );
        trackVariableDeclarator(
          node,
          provenance,
          helperNames,
          namespaceHelpers,
          scopedHelpers,
          scopes
        );
        return;
      }
      if (node.type === 'AssignmentExpression') {
        trackAssignmentExpression(
          node,
          provenance,
          helperNames,
          namespaceHelpers,
          scopedHelpers,
          scopes
        );
        return;
      }
      if (node.type === 'ReturnStatement') {
        checkReturnStatement(
          node,
          provenance,
          scopes,
          filePath,
          sourceCode,
          trailId,
          diagnostics
        );
      }
    },
    { initialScopes, stopAtNestedFunctions: true }
  );
};

export const noRedundantResultErrorWrap: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const helperNames = collectAllResultHelperNames(ast, sourceCode, filePath);
    const namespaceHelpers = collectNamespaceHelperImports(ast, filePath);
    const resultTypeNames = collectResultTypeNames(ast);
    for (const def of findTrailDefinitions(ast)) {
      for (const blaze of findBlazeBodies(def.config)) {
        checkBlazeBody(
          blaze,
          def.id,
          filePath,
          sourceCode,
          helperNames,
          namespaceHelpers,
          resultTypeNames,
          diagnostics
        );
      }
    }
    return diagnostics;
  },
  description:
    'Warn when blazes re-wrap an existing Result error with Result.err(x.error) instead of returning the Result directly.',
  name: RULE_NAME,
  severity: 'warn',
};
