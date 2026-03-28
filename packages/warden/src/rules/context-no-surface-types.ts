/**
 * Detects imports of surface-specific modules and types in trail files.
 *
 * Uses AST parsing for accurate detection — no false positives from
 * imports in comments or strings.
 */

import { offsetToLine, parse, walk } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const SURFACE_MODULES = new Set([
  'express',
  'hono',
  'fastify',
  '@modelcontextprotocol/sdk',
  'node:http',
  'node:https',
  '@hono/node-server',
  'koa',
]);

const SURFACE_TYPE_NAMES = new Set([
  'Request',
  'Response',
  'NextFunction',
  'McpSession',
  'McpCallToolRequest',
  'IncomingMessage',
  'ServerResponse',
]);

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly [key: string]: unknown;
}

interface ImportSpecifier {
  readonly local?: { readonly name?: string };
  readonly imported?: { readonly name?: string };
}

const makeDiag = (
  filePath: string,
  sourceCode: string,
  node: AstNode,
  message: string
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, node.start),
  message,
  rule: 'context-no-surface-types',
  severity: 'error',
});

const findSurfaceTypeName = (
  specifiers: readonly ImportSpecifier[]
): string | undefined => {
  for (const spec of specifiers) {
    const name = spec.imported?.name ?? spec.local?.name;
    if (name && SURFACE_TYPE_NAMES.has(name)) {
      return name;
    }
  }
  return undefined;
};

const getImportModuleName = (node: AstNode): string | null => {
  if (node.type !== 'ImportDeclaration') {
    return null;
  }
  const source = node['source'] as { readonly value?: string } | undefined;
  return source?.value ?? null;
};

const checkSpecifiersForSurfaceTypes = (
  node: AstNode,
  filePath: string,
  sourceCode: string
): WardenDiagnostic | undefined => {
  const specifiers = node['specifiers'] as
    | readonly ImportSpecifier[]
    | undefined;
  if (!specifiers) {
    return undefined;
  }
  const typeName = findSurfaceTypeName(specifiers);
  if (!typeName) {
    return undefined;
  }
  return makeDiag(
    filePath,
    sourceCode,
    node,
    `Do not import surface type "${typeName}" in trail implementation files.`
  );
};

const classifyImport = (
  node: AstNode,
  filePath: string,
  sourceCode: string
): WardenDiagnostic | undefined => {
  const moduleName = getImportModuleName(node);
  if (!moduleName) {
    return undefined;
  }

  if (SURFACE_MODULES.has(moduleName)) {
    return makeDiag(
      filePath,
      sourceCode,
      node,
      `Do not import from surface module "${moduleName}" in trail implementation files.`
    );
  }

  return checkSpecifiersForSurfaceTypes(node, filePath, sourceCode);
};

/**
 * Detects imports of surface-specific types in trail implementation files.
 */
export const contextNoSurfaceTypes: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (!/\b(?:trail|hike)\s*\(/.test(sourceCode)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    walk(ast, (node) => {
      const diag = classifyImport(node as AstNode, filePath, sourceCode);
      if (diag) {
        diagnostics.push(diag);
      }
    });

    return diagnostics;
  },
  description:
    'Disallow surface-specific type imports (Request, Response, McpSession, etc.) in trail implementation files.',
  name: 'context-no-surface-types',

  severity: 'error',
};
