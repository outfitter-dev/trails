import { ValidationError } from '@ontrails/core';
import {
  extractStringLiteral,
  identifierName,
  parseWithDiagnostics,
  propertyKeyName,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';

import { parseTrailsConfigData } from './trails-config-file.js';

type StaticIdentityReason =
  | 'dynamic-expression'
  | 'invalid-app'
  | 'invalid-path'
  | 'invalid-shape'
  | 'parse-error';

export const staticIdentityError = (
  message: string,
  filePath: string,
  reason: StaticIdentityReason,
  context: Record<string, unknown> = {}
): ValidationError =>
  new ValidationError(message, {
    context: { ...context, path: filePath, reason, section: 'workspace.apps' },
  });

const propertiesOf = (node: AstNode, filePath: string): readonly AstNode[] => {
  if (node.type !== 'ObjectExpression') {
    throw staticIdentityError(
      `workspace.apps must use inline object literals in ${filePath}; move project identity out of variables, calls, spreads, and conditionals.`,
      filePath,
      'dynamic-expression',
      { expressionType: node.type }
    );
  }
  return (node['properties'] as readonly AstNode[] | undefined) ?? [];
};

const staticPropertyEntries = (
  node: AstNode,
  filePath: string,
  label: string
): ReadonlyMap<string, AstNode> => {
  const entries = new Map<string, AstNode>();
  for (const property of propertiesOf(node, filePath)) {
    if (property.type !== 'Property') {
      throw staticIdentityError(
        `${label} must not use spreads in ${filePath}; author workspace identity as direct literal properties.`,
        filePath,
        'dynamic-expression',
        { expressionType: property.type }
      );
    }
    const key = propertyKeyName(property);
    const value = property['value'] as AstNode | undefined;
    if (key === null || value === undefined) {
      throw staticIdentityError(
        `${label} must not use computed keys or shorthand values in ${filePath}.`,
        filePath,
        'dynamic-expression'
      );
    }
    if (entries.has(key)) {
      throw staticIdentityError(
        `${label} declares "${key}" more than once in ${filePath}.`,
        filePath,
        'invalid-shape',
        { key }
      );
    }
    entries.set(key, value);
  }
  return entries;
};

const findConfigHelperNames = (
  body: readonly AstNode[]
): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const node of body) {
    if (node.type !== 'ImportDeclaration') {
      continue;
    }
    const source = extractStringLiteral(node['source'] as AstNode | undefined);
    if (source !== '@ontrails/config') {
      continue;
    }
    const specifiers =
      (node['specifiers'] as readonly AstNode[] | undefined) ?? [];
    for (const specifier of specifiers) {
      if (specifier.type !== 'ImportSpecifier') {
        continue;
      }
      const imported = identifierName(
        specifier['imported'] as AstNode | undefined
      );
      const local = identifierName(specifier['local'] as AstNode | undefined);
      if (imported === 'defineConfig' && local !== null) {
        names.add(local);
      }
    }
  }
  return names;
};

const findDefaultDeclaration = (
  body: readonly AstNode[],
  filePath: string
): AstNode => {
  const defaults = body.filter(
    (node) => node.type === 'ExportDefaultDeclaration'
  );
  const declaration = defaults[0]?.['declaration'] as AstNode | undefined;
  if (defaults.length !== 1 || declaration === undefined) {
    throw staticIdentityError(
      `Static workspace identity in ${filePath} requires one export default object or defineConfig({...}) call.`,
      filePath,
      'invalid-shape'
    );
  }
  return declaration;
};

const unwrapConfigObject = (
  declaration: AstNode,
  helperNames: ReadonlySet<string>,
  filePath: string
): AstNode => {
  if (declaration.type !== 'CallExpression') {
    return declaration;
  }
  const callee = declaration['callee'] as AstNode | undefined;
  const args =
    (declaration['arguments'] as readonly AstNode[] | undefined) ?? [];
  const helperName = identifierName(callee);
  if (
    helperName === null ||
    !helperNames.has(helperName) ||
    args.length !== 1
  ) {
    throw staticIdentityError(
      `Static workspace identity in ${filePath} may only use defineConfig({...}) imported from @ontrails/config.`,
      filePath,
      'dynamic-expression',
      { expressionType: declaration.type }
    );
  }
  return args[0] as AstNode;
};

const extractLiteralApps = (
  appsNode: AstNode,
  filePath: string
): Record<string, unknown> => {
  const apps = new Map<string, unknown>();
  const appsEntries = staticPropertyEntries(
    appsNode,
    filePath,
    'workspace.apps'
  );
  for (const [id, appNode] of appsEntries) {
    const appEntries = staticPropertyEntries(
      appNode,
      filePath,
      `workspace.apps.${id}`
    );
    const app = new Map<string, unknown>();
    for (const [key, valueNode] of appEntries) {
      if (key !== 'entry' && key !== 'root') {
        throw staticIdentityError(
          `workspace.apps.${id} contains unsupported field "${key}". Use only root and the optional entry override.`,
          filePath,
          'invalid-app',
          { appId: id, field: key }
        );
      }
      const literal = extractStringLiteral(valueNode);
      if (literal === null) {
        throw staticIdentityError(
          `workspace.apps.${id}.${key} must be a direct string literal in ${filePath}; environment reads, identifiers, imports, calls, and conditionals are not allowed.`,
          filePath,
          'dynamic-expression',
          { appId: id, expressionType: valueNode.type, field: key }
        );
      }
      app.set(key, literal);
    }
    apps.set(id, Object.fromEntries(app));
  }
  return Object.fromEntries(apps);
};

const extractWorkspaceFromModule = (
  filePath: string,
  sourceCode: string
): unknown => {
  const parsed = parseWithDiagnostics(filePath, sourceCode);
  if (parsed.ast === null || parsed.diagnostics.length > 0) {
    throw staticIdentityError(
      `Unable to parse static workspace identity from ${filePath}. Fix the TypeScript syntax before running a workspace command.`,
      filePath,
      'parse-error',
      { diagnostics: parsed.diagnostics }
    );
  }

  const body = (parsed.ast['body'] as readonly AstNode[] | undefined) ?? [];
  const declaration = findDefaultDeclaration(body, filePath);
  const configObject = unwrapConfigObject(
    declaration,
    findConfigHelperNames(body),
    filePath
  );
  const configEntries = staticPropertyEntries(
    configObject,
    filePath,
    'The default config object'
  );
  const workspaceNode = configEntries.get('workspace');
  if (workspaceNode === undefined) {
    return undefined;
  }
  const workspaceEntries = staticPropertyEntries(
    workspaceNode,
    filePath,
    'workspace'
  );
  const appsNode = workspaceEntries.get('apps');
  if (appsNode === undefined || workspaceEntries.size !== 1) {
    throw staticIdentityError(
      `workspace in ${filePath} must contain exactly one literal apps catalog.`,
      filePath,
      'invalid-shape'
    );
  }
  return { apps: extractLiteralApps(appsNode, filePath) };
};

const extensionFor = (filePath: string): string | undefined =>
  ['.jsonc', '.json', '.toml', '.yaml', '.mts', '.mjs', '.ts', '.js'].find(
    (extension) => filePath.endsWith(extension)
  );

export const parseTrailsProjectConfigFile = async (
  filePath: string
): Promise<unknown> => {
  const text = await Bun.file(filePath).text();
  try {
    switch (extensionFor(filePath)) {
      case '.json': {
        return parseTrailsConfigData(filePath, text);
      }
      case '.jsonc': {
        return parseTrailsConfigData(filePath, text);
      }
      case '.toml': {
        return parseTrailsConfigData(filePath, text);
      }
      case '.yaml': {
        return parseTrailsConfigData(filePath, text);
      }
      case '.js':
      case '.mjs':
      case '.mts':
      case '.ts': {
        return { workspace: extractWorkspaceFromModule(filePath, text) };
      }
      default: {
        throw staticIdentityError(
          `Unsupported Trails config file: ${filePath}`,
          filePath,
          'invalid-shape'
        );
      }
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw staticIdentityError(
      `Failed to parse static workspace identity from ${filePath}.`,
      filePath,
      'parse-error',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
};
