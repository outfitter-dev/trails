import {
  collectScopeFrameBindings,
  extractStringLiteral,
  getNodeArguments,
  getNodeCallee,
  getNodeDeclaration,
  getNodeDeclarations,
  getNodeExpression,
  identifierName,
  parseWithDiagnostics,
  propertyKeyName,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';

type ExportKey = 'app' | 'default' | 'graph';

type ExportCandidate = AstNode | 'unknown';

type DerivedIdentity =
  | { readonly kind: 'known'; readonly id: string }
  | { readonly kind: 'nullish' }
  | { readonly kind: 'unknown' };

const exportKeys = ['default', 'graph', 'app'] as const;

const unwrapExpression = (node: AstNode): AstNode => {
  let current = node;
  while (
    current.type === 'ParenthesizedExpression' ||
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression'
  ) {
    const expression = getNodeExpression(current);
    if (expression === undefined) {
      break;
    }
    current = expression;
  }
  return current;
};

const importSource = (node: AstNode): string | null =>
  extractStringLiteral(node['source'] as AstNode | undefined);

const exportedName = (node: AstNode): string | null =>
  identifierName(node['exported'] as AstNode | undefined) ??
  extractStringLiteral(node['exported'] as AstNode | undefined);

const localName = (node: AstNode): string | null =>
  identifierName(node['local'] as AstNode | undefined) ??
  extractStringLiteral(node['local'] as AstNode | undefined);

const isExportKey = (value: string | null): value is ExportKey =>
  value !== null && exportKeys.includes(value as ExportKey);

const setExportCandidate = (
  candidates: Map<ExportKey, ExportCandidate>,
  key: ExportKey,
  candidate: ExportCandidate
): void => {
  candidates.set(key, candidates.has(key) ? 'unknown' : candidate);
};

interface StaticModuleFacts {
  readonly bindings: ReadonlyMap<string, AstNode>;
  readonly candidates: ReadonlyMap<ExportKey, ExportCandidate>;
  readonly hasStarExport: boolean;
  readonly moduleBindings: ReadonlySet<string>;
  readonly namespaceTopoBindings: ReadonlySet<string>;
  readonly topoBindings: ReadonlySet<string>;
}

const collectConstBindings = (
  declaration: AstNode,
  bindings: Map<string, AstNode>
): void => {
  if (declaration.type !== 'VariableDeclaration') {
    return;
  }
  const isConst = declaration['kind'] === 'const';
  for (const declarator of getNodeDeclarations(declaration)) {
    const name = identifierName(declarator['id'] as AstNode | undefined);
    const init = declarator['init'] as AstNode | undefined;
    if (name !== null && init !== undefined && isConst) {
      bindings.set(name, init);
    }
  }
};

const collectTopoImports = (
  statement: AstNode,
  moduleBindings: Set<string>,
  namespaceTopoBindings: Set<string>,
  topoBindings: Set<string>
): void => {
  if (
    statement.type !== 'ImportDeclaration' ||
    statement['importKind'] === 'type'
  ) {
    return;
  }
  const importsTrailsCore = importSource(statement) === '@ontrails/core';
  const specifiers =
    (statement['specifiers'] as readonly AstNode[] | undefined) ?? [];
  for (const specifier of specifiers) {
    const local = identifierName(specifier['local'] as AstNode | undefined);
    if (specifier['importKind'] === 'type' || local === null) {
      continue;
    }
    moduleBindings.add(local);
    if (!importsTrailsCore) {
      continue;
    }
    if (specifier.type === 'ImportNamespaceSpecifier') {
      namespaceTopoBindings.add(local);
    } else if (
      specifier.type === 'ImportSpecifier' &&
      identifierName(specifier['imported'] as AstNode | undefined) === 'topo'
    ) {
      topoBindings.add(local);
    }
  }
};

const collectNamedExportCandidates = (
  statement: AstNode,
  bindings: ReadonlyMap<string, AstNode>,
  candidates: Map<ExportKey, ExportCandidate>
): void => {
  const declaration = getNodeDeclaration(statement);
  if (declaration?.type === 'VariableDeclaration') {
    for (const declarator of getNodeDeclarations(declaration)) {
      const name = identifierName(declarator['id'] as AstNode | undefined);
      if (isExportKey(name)) {
        setExportCandidate(
          candidates,
          name,
          (declarator['init'] as AstNode | undefined) ?? 'unknown'
        );
      }
    }
  } else if (declaration !== undefined && declaration !== null) {
    const name = identifierName(declaration['id'] as AstNode | undefined);
    if (isExportKey(name)) {
      setExportCandidate(candidates, name, 'unknown');
    }
  }

  const specifiers =
    (statement['specifiers'] as readonly AstNode[] | undefined) ?? [];
  for (const specifier of specifiers) {
    const exported = exportedName(specifier);
    if (!isExportKey(exported)) {
      continue;
    }
    if (statement['source'] !== null && statement['source'] !== undefined) {
      setExportCandidate(candidates, exported, 'unknown');
      continue;
    }
    const local = localName(specifier);
    setExportCandidate(
      candidates,
      exported,
      local === null ? 'unknown' : (bindings.get(local) ?? 'unknown')
    );
  }
};

const collectStaticModuleFacts = (ast: AstNode): StaticModuleFacts => {
  const bindings = new Map<string, AstNode>();
  const candidates = new Map<ExportKey, ExportCandidate>();
  const moduleBindings = new Set(collectScopeFrameBindings(ast));
  const namespaceTopoBindings = new Set<string>();
  const topoBindings = new Set<string>();
  const body = (ast['body'] as readonly AstNode[] | undefined) ?? [];

  for (const statement of body) {
    collectTopoImports(
      statement,
      moduleBindings,
      namespaceTopoBindings,
      topoBindings
    );
    const declaration =
      statement.type === 'ExportNamedDeclaration'
        ? getNodeDeclaration(statement)
        : statement;
    if (declaration !== undefined && declaration !== null) {
      collectConstBindings(declaration, bindings);
    }
  }

  let hasStarExport = false;
  for (const statement of body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = getNodeDeclaration(statement);
      setExportCandidate(candidates, 'default', declaration ?? 'unknown');
    } else if (statement.type === 'ExportAllDeclaration') {
      const exported = identifierName(
        statement['exported'] as AstNode | undefined
      );
      if (isExportKey(exported)) {
        setExportCandidate(candidates, exported, 'unknown');
      } else {
        hasStarExport = true;
      }
    } else if (statement.type === 'ExportNamedDeclaration') {
      collectNamedExportCandidates(statement, bindings, candidates);
    }
  }

  return {
    bindings,
    candidates,
    hasStarExport,
    moduleBindings,
    namespaceTopoBindings,
    topoBindings,
  };
};

const isTopoCall = (node: AstNode, facts: StaticModuleFacts): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = getNodeCallee(node);
  const bareName = identifierName(callee);
  if (bareName !== null) {
    return facts.topoBindings.has(bareName);
  }
  if (
    callee?.type !== 'MemberExpression' &&
    callee?.type !== 'StaticMemberExpression'
  ) {
    return false;
  }
  if (callee['computed'] === true) {
    return false;
  }
  const receiver = identifierName(callee['object'] as AstNode | undefined);
  const member = identifierName(callee['property'] as AstNode | undefined);
  return (
    receiver !== null &&
    member === 'topo' &&
    facts.namespaceTopoBindings.has(receiver)
  );
};

const isSupportedStaticExpression = (
  node: AstNode,
  facts: StaticModuleFacts
): boolean => {
  const expression = unwrapExpression(node);
  if (
    identifierName(expression) !== null ||
    extractStringLiteral(expression) !== null ||
    expression.type === 'NullLiteral' ||
    expression.type === 'BooleanLiteral' ||
    expression.type === 'NumericLiteral' ||
    expression.type === 'BigIntLiteral' ||
    expression.type === 'FunctionExpression' ||
    expression.type === 'ArrowFunctionExpression'
  ) {
    return true;
  }
  if (isTopoCall(expression, facts)) {
    return getNodeArguments(expression).every((argument) =>
      isSupportedStaticExpression(argument, facts)
    );
  }
  if (expression.type === 'NewExpression') {
    const constructorName = identifierName(getNodeCallee(expression));
    const arguments_ = getNodeArguments(expression);
    return (
      (constructorName === 'Map' || constructorName === 'Set') &&
      !facts.moduleBindings.has(constructorName) &&
      arguments_.length === 0
    );
  }
  if (expression.type === 'ArrayExpression') {
    const elements =
      (expression['elements'] as readonly (AstNode | null)[] | undefined) ?? [];
    return elements.every(
      (element) =>
        element === null || isSupportedStaticExpression(element, facts)
    );
  }
  if (expression.type !== 'ObjectExpression') {
    return false;
  }
  const properties =
    (expression['properties'] as readonly AstNode[] | undefined) ?? [];
  return properties.every(
    (property) =>
      property.type === 'Property' &&
      property['computed'] !== true &&
      property['kind'] === 'init' &&
      property['method'] !== true &&
      isSupportedStaticExpression(property['value'] as AstNode, facts)
  );
};

const isSupportedVariableDeclaration = (
  declaration: AstNode,
  facts: StaticModuleFacts
): boolean =>
  declaration.type === 'VariableDeclaration' &&
  declaration['kind'] === 'const' &&
  getNodeDeclarations(declaration).every((declarator) => {
    const init = declarator['init'] as AstNode | undefined;
    return (
      identifierName(declarator['id'] as AstNode | undefined) !== null &&
      (init === undefined || isSupportedStaticExpression(init, facts))
    );
  });

const isSupportedModuleStatement = (
  statement: AstNode,
  facts: StaticModuleFacts
): boolean => {
  if (
    statement.type === 'ImportDeclaration' ||
    statement.type === 'TSInterfaceDeclaration' ||
    statement.type === 'TSTypeAliasDeclaration' ||
    statement.type === 'FunctionDeclaration'
  ) {
    return true;
  }
  if (statement.type === 'VariableDeclaration') {
    return isSupportedVariableDeclaration(statement, facts);
  }
  if (statement.type === 'ExportDefaultDeclaration') {
    const declaration = getNodeDeclaration(statement);
    return (
      declaration !== undefined &&
      declaration !== null &&
      isSupportedStaticExpression(declaration, facts)
    );
  }
  if (statement.type !== 'ExportNamedDeclaration') {
    return false;
  }
  if (statement['source'] !== null && statement['source'] !== undefined) {
    return false;
  }
  const declaration = getNodeDeclaration(statement);
  return (
    declaration === undefined ||
    declaration === null ||
    declaration.type === 'FunctionDeclaration' ||
    declaration.type === 'TSInterfaceDeclaration' ||
    declaration.type === 'TSTypeAliasDeclaration' ||
    isSupportedVariableDeclaration(declaration, facts)
  );
};

const hasSupportedStaticModuleShape = (
  ast: AstNode,
  facts: StaticModuleFacts
): boolean => {
  const body = (ast['body'] as readonly AstNode[] | undefined) ?? [];
  return body.every((statement) =>
    isSupportedModuleStatement(statement, facts)
  );
};

const deriveCertainObjectName = (node: AstNode): string | undefined => {
  if (node.type !== 'ObjectExpression') {
    return undefined;
  }
  const properties =
    (node['properties'] as readonly AstNode[] | undefined) ?? [];
  const names: string[] = [];
  for (const property of properties) {
    if (property.type !== 'Property' || property['computed'] === true) {
      return undefined;
    }
    if (propertyKeyName(property) !== 'name') {
      continue;
    }
    const name = extractStringLiteral(property['value'] as AstNode | undefined);
    if (name === null) {
      return undefined;
    }
    names.push(name);
  }
  return names.length === 1 ? names[0] : undefined;
};

const deriveExpressionIdentity = (
  candidate: AstNode,
  facts: StaticModuleFacts,
  seen: ReadonlySet<string> = new Set()
): DerivedIdentity => {
  const expression = unwrapExpression(candidate);
  if (
    expression.type === 'NullLiteral' ||
    (expression.type === 'Literal' && expression['value'] === null)
  ) {
    return { kind: 'nullish' };
  }

  const bindingName = identifierName(expression);
  if (bindingName !== null) {
    if (seen.has(bindingName)) {
      return { kind: 'unknown' };
    }
    const binding = facts.bindings.get(bindingName);
    return binding === undefined
      ? { kind: 'unknown' }
      : deriveExpressionIdentity(
          binding,
          facts,
          new Set([...seen, bindingName])
        );
  }

  if (isTopoCall(expression, facts)) {
    const [identity] = getNodeArguments(expression);
    const id =
      extractStringLiteral(identity) ??
      (identity === undefined
        ? undefined
        : deriveCertainObjectName(unwrapExpression(identity)));
    return id === undefined ? { kind: 'unknown' } : { id, kind: 'known' };
  }

  if (expression.type === 'ObjectExpression') {
    const id = deriveCertainObjectName(expression);
    return id === undefined ? { kind: 'unknown' } : { id, kind: 'known' };
  }

  return { kind: 'unknown' };
};

/**
 * Derive the runtime-selected topo ID when source makes it statically certain.
 *
 * Unknown, dynamic, helper-built, and re-exported forms intentionally return
 * undefined so runtime app loading remains their binding authority.
 *
 * @example
 * ```ts
 * deriveStaticSelectedTopoId('src/app.ts', "export const app = topo('demo')")
 * // undefined: topo is not proven to be imported from @ontrails/core
 * ```
 */
export const deriveStaticSelectedTopoId = (
  filePath: string,
  sourceCode: string
): string | undefined => {
  const parsed = parseWithDiagnostics(filePath, sourceCode);
  if (parsed.ast === null || parsed.diagnostics.length > 0) {
    return undefined;
  }

  const facts = collectStaticModuleFacts(parsed.ast);
  if (!hasSupportedStaticModuleShape(parsed.ast, facts)) {
    return undefined;
  }
  for (const key of exportKeys) {
    const candidate = facts.candidates.get(key);
    if (candidate === undefined) {
      if (key !== 'default' && facts.hasStarExport) {
        return undefined;
      }
      continue;
    }
    if (candidate === 'unknown') {
      return undefined;
    }
    const identity = deriveExpressionIdentity(candidate, facts);
    if (identity.kind === 'nullish') {
      continue;
    }
    return identity.kind === 'known' ? identity.id : undefined;
  }
  return undefined;
};
