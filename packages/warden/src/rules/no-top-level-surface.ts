import {
  getNodeArgument,
  getNodeBodyStatements,
  getNodeCallee,
  getNodeComputed,
  getNodeDeclaration,
  getNodeDeclarations,
  getNodeExported,
  getNodeExpression,
  getNodeId,
  getNodeImported,
  getNodeInit,
  getNodeLeft,
  getNodeLocal,
  getNodeObject,
  getNodeProperty,
  getNodeSource,
  getNodeSpecifiers,
  getStringValue,
  identifierName,
  isStringLiteral,
  offsetToLine,
  parse,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'no-top-level-surface';

const TOPO_EXPORT_NAMES = new Set(['app', 'graph']);
const SURFACE_OPEN_CALLEE_NAMES = new Set([
  'connectStdio',
  'startServer',
  'surface',
]);
const TOPO_IMPORT_SOURCES = new Set(['@ontrails/core']);
const SURFACE_IMPORT_SOURCES = new Set([
  '@ontrails/commander',
  '@ontrails/hono',
  '@ontrails/http',
  '@ontrails/http/bun',
  '@ontrails/mcp',
]);

const diagnosticMessage =
  'This module exports a topo and opens a surface at module top level. Trails introspection commands (`survey`, `guide`, `compile`) import topo entry modules, so opening a surface here can trigger sockets or transports during introspection. Move surface-opening to a separate entry/bin and keep the topo-export module side-effect-free.';

const unwrapExportDeclaration = (node: AstNode): AstNode =>
  node.type === 'ExportNamedDeclaration' ||
  node.type === 'ExportDefaultDeclaration'
    ? (getNodeDeclaration(node) ?? node)
    : node;

interface ImportedBindings {
  readonly named: ReadonlyMap<string, string>;
  readonly namespaces: ReadonlySet<string>;
}

const importSource = (node: AstNode): string | null => {
  const source = getNodeSource(node);
  return source && isStringLiteral(source) ? getStringValue(source) : null;
};

const importedSpecifierName = (node: AstNode | undefined): string | null =>
  identifierName(node) ??
  (node && isStringLiteral(node) ? getStringValue(node) : null);

const addFrameworkImportBindings = (
  ast: AstNode,
  sources: ReadonlySet<string>,
  allowedImports: ReadonlySet<string>
): ImportedBindings => {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  const body = getNodeBodyStatements(ast);

  for (const statement of body) {
    if (
      statement.type !== 'ImportDeclaration' ||
      !sources.has(importSource(statement) ?? '')
    ) {
      continue;
    }

    const specifiers = getNodeSpecifiers(statement);
    for (const specifier of specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') {
        const localName = identifierName(getNodeLocal(specifier));
        if (localName) {
          namespaces.add(localName);
        }
        continue;
      }
      if (specifier.type !== 'ImportSpecifier') {
        continue;
      }

      const imported = getNodeImported(specifier);
      const local = getNodeLocal(specifier);
      const importedName = importedSpecifierName(imported);
      const localName = identifierName(local);
      if (importedName && allowedImports.has(importedName) && localName) {
        named.set(localName, importedName);
      }
    }
  }

  return { named, namespaces };
};

const unwrapExpression = (node: AstNode | undefined): AstNode | undefined => {
  let current = node;
  while (
    current?.type === 'AwaitExpression' ||
    current?.type === 'ChainExpression' ||
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSSatisfiesExpression'
  ) {
    current = getNodeExpression(current) ?? getNodeArgument(current);
  }
  return current;
};

const memberExpressionParts = (
  node: AstNode | undefined
): { objectName: string | null; propertyName: string | null } => {
  if (node?.type !== 'MemberExpression') {
    return { objectName: null, propertyName: null };
  }
  const computed = getNodeComputed(node);
  const property = getNodeProperty(node);
  return {
    objectName: identifierName(getNodeObject(node)),
    propertyName: computed ? null : identifierName(property),
  };
};

const calleeName = (
  node: AstNode | undefined,
  bindings: ImportedBindings
): string | null => {
  const callee = unwrapExpression(node);
  if (!callee) {
    return null;
  }
  const directName = identifierName(callee);
  if (directName && bindings.named.has(directName)) {
    return bindings.named.get(directName) ?? null;
  }

  const { objectName, propertyName } = memberExpressionParts(callee);
  if (
    objectName &&
    propertyName &&
    bindings.namespaces.has(objectName) &&
    (SURFACE_OPEN_CALLEE_NAMES.has(propertyName) || propertyName === 'topo')
  ) {
    return propertyName;
  }

  return null;
};

const isTopoCall = (
  node: AstNode | undefined,
  bindings: ImportedBindings
): boolean =>
  calleeName(getNodeCallee(unwrapExpression(node)), bindings) === 'topo';

const isSurfaceOpenCall = (
  node: AstNode | undefined,
  bindings: ImportedBindings
): boolean => {
  const expression = unwrapExpression(node);
  if (expression?.type !== 'CallExpression') {
    return false;
  }

  const callee = getNodeCallee(expression);
  const directName = calleeName(callee, bindings);
  if (directName && SURFACE_OPEN_CALLEE_NAMES.has(directName)) {
    return true;
  }
  const { objectName, propertyName } = memberExpressionParts(callee);
  if (
    objectName &&
    propertyName === 'listen' &&
    bindings.namespaces.has(objectName)
  ) {
    return true;
  }

  return false;
};

const declarationIdName = (node: AstNode | undefined): string | null =>
  identifierName(node) ?? identifierName(node ? getNodeLeft(node) : undefined);

const collectTopLevelTopoBindings = (
  ast: AstNode,
  topoBindings: ImportedBindings
): ReadonlySet<string> => {
  const bindings = new Set<string>();
  const body = getNodeBodyStatements(ast);

  for (const statement of body) {
    const declaration = unwrapExportDeclaration(statement);
    if (declaration.type === 'VariableDeclaration') {
      const declarations = getNodeDeclarations(declaration);
      for (const item of declarations) {
        const id = getNodeId(item);
        const init = getNodeInit(item);
        const name = declarationIdName(id);
        if (name && isTopoCall(init, topoBindings)) {
          bindings.add(name);
        }
      }
    }
  }

  return bindings;
};

const namedExportCarriesTopo = (
  statement: AstNode,
  topLevelTopoBindings: ReadonlySet<string>
): boolean => {
  const specifiers = getNodeSpecifiers(statement) ?? [];

  for (const specifier of specifiers) {
    const exported = getNodeExported(specifier);
    const local = getNodeLocal(specifier);
    const exportedName = identifierName(exported);
    const localName = identifierName(local);
    if (
      exportedName &&
      TOPO_EXPORT_NAMES.has(exportedName) &&
      localName &&
      topLevelTopoBindings.has(localName)
    ) {
      return true;
    }
  }

  return false;
};

const moduleExportsTopo = (
  ast: AstNode,
  topoBindings: ImportedBindings
): boolean => {
  const topLevelTopoBindings = collectTopLevelTopoBindings(ast, topoBindings);
  const body = getNodeBodyStatements(ast);

  for (const statement of body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = unwrapExportDeclaration(statement);
      if (isTopoCall(declaration, topoBindings)) {
        return true;
      }
      const defaultName = identifierName(declaration);
      if (defaultName && topLevelTopoBindings.has(defaultName)) {
        return true;
      }
    }

    if (statement.type === 'ExportNamedDeclaration') {
      const declaration = unwrapExportDeclaration(statement);
      if (namedExportCarriesTopo(statement, topLevelTopoBindings)) {
        return true;
      }
      if (declaration.type !== 'VariableDeclaration') {
        continue;
      }
      const declarations = getNodeDeclarations(declaration);
      for (const item of declarations) {
        const id = getNodeId(item);
        const init = getNodeInit(item);
        const name = declarationIdName(id);
        if (
          name &&
          TOPO_EXPORT_NAMES.has(name) &&
          isTopoCall(init, topoBindings)
        ) {
          return true;
        }
      }
    }
  }

  return false;
};

const topLevelSurfaceOpen = (
  statement: AstNode,
  surfaceBindings: ImportedBindings
): AstNode | null => {
  const declaration = unwrapExportDeclaration(statement);
  if (declaration.type === 'ExpressionStatement') {
    const expression = getNodeExpression(declaration);
    const unwrapped = unwrapExpression(expression);
    return isSurfaceOpenCall(unwrapped, surfaceBindings)
      ? (unwrapped ?? null)
      : null;
  }

  const unwrappedDeclaration = unwrapExpression(declaration);
  if (isSurfaceOpenCall(unwrappedDeclaration, surfaceBindings)) {
    return unwrappedDeclaration ?? null;
  }

  if (declaration.type !== 'VariableDeclaration') {
    return null;
  }

  const declarations = getNodeDeclarations(declaration);
  for (const item of declarations) {
    const init = getNodeInit(item);
    const unwrapped = unwrapExpression(init);
    if (isSurfaceOpenCall(unwrapped, surfaceBindings)) {
      return unwrapped ?? null;
    }
  }

  return null;
};

export const noTopLevelSurface: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const topoBindings = addFrameworkImportBindings(
      ast,
      TOPO_IMPORT_SOURCES,
      new Set(['topo'])
    );
    if (!moduleExportsTopo(ast, topoBindings)) {
      return [];
    }
    const surfaceBindings = addFrameworkImportBindings(
      ast,
      SURFACE_IMPORT_SOURCES,
      SURFACE_OPEN_CALLEE_NAMES
    );

    const diagnostics: WardenDiagnostic[] = [];
    const body = getNodeBodyStatements(ast);
    for (const statement of body) {
      const surfaceOpen = topLevelSurfaceOpen(statement, surfaceBindings);
      if (!surfaceOpen) {
        continue;
      }
      diagnostics.push({
        filePath,
        line: offsetToLine(sourceCode, surfaceOpen.start),
        message: diagnosticMessage,
        rule: RULE_NAME,
        severity: 'warn',
      });
    }

    return diagnostics;
  },
  description:
    'Coach topo export modules to keep surface-opening side effects out of module top level.',
  name: RULE_NAME,
  severity: 'warn',
};
