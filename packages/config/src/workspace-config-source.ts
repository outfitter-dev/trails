import { ValidationError } from '@ontrails/core';
import {
  extractStringLiteral,
  extractStringOrTemplateLiteral,
  getNodeExpression,
  identifierName,
  parseWithDiagnostics,
  propertyKeyName,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import { isMap, isScalar, parseDocument } from 'yaml';

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

/** Unwrap `as const`, `satisfies`, and parenthesized wrappers. */
const unwrapExpression = (node: AstNode): AstNode => {
  let current = node;
  while (
    current.type === 'ParenthesizedExpression' ||
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression'
  ) {
    const inner = getNodeExpression(current);
    if (inner === undefined) {
      return current;
    }
    current = inner;
  }
  return current;
};

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
  for (const property of propertiesOf(unwrapExpression(node), filePath)) {
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
    entries.set(key, unwrapExpression(value));
  }
  return entries;
};

const directPropertyKey = (property: AstNode): string | null => {
  if (property.type !== 'Property' || property['computed'] === true) {
    return null;
  }
  return propertyKeyName(property);
};

const computedPropertyKey = (property: AstNode): string | null =>
  property.type === 'Property' && property['computed'] === true
    ? extractStringOrTemplateLiteral(property['key'] as AstNode | undefined)
    : null;

/** Locate the sole explicit workspace property without constraining deployment. */
const findWorkspaceNode = (
  configObject: AstNode,
  filePath: string
): AstNode | undefined => {
  const properties = propertiesOf(unwrapExpression(configObject), filePath);
  const workspaceProperties = properties.filter(
    (property) => directPropertyKey(property) === 'workspace'
  );
  if (workspaceProperties.length > 1) {
    throw staticIdentityError(
      `The default config object declares "workspace" more than once in ${filePath}.`,
      filePath,
      'invalid-shape',
      { key: 'workspace' }
    );
  }
  const [workspaceProperty] = workspaceProperties;
  if (workspaceProperty === undefined) {
    const computedWorkspace = properties.find(
      (property) => computedPropertyKey(property) === 'workspace'
    );
    if (computedWorkspace !== undefined) {
      throw staticIdentityError(
        `Static workspace identity in ${filePath} must use a direct workspace property.`,
        filePath,
        'dynamic-expression',
        { expressionType: computedWorkspace.type }
      );
    }
    const possibleWorkspaceProvider = properties.find(
      (property) =>
        property.type !== 'Property' ||
        (property['computed'] === true &&
          computedPropertyKey(property) === null)
    );
    if (possibleWorkspaceProvider !== undefined) {
      throw staticIdentityError(
        `Static workspace identity in ${filePath} cannot be proven absent because spreads or computed properties could supply workspace.`,
        filePath,
        'dynamic-expression',
        { expressionType: possibleWorkspaceProvider.type }
      );
    }
    return undefined;
  }
  const workspaceIndex = properties.indexOf(workspaceProperty);
  const possibleOverride = properties
    .slice(workspaceIndex + 1)
    .find(
      (property) =>
        property.type !== 'Property' ||
        (property['computed'] === true &&
          (computedPropertyKey(property) === null ||
            computedPropertyKey(property) === 'workspace'))
    );
  if (possibleOverride !== undefined) {
    throw staticIdentityError(
      `Static workspace identity in ${filePath} must follow spreads and computed properties that could override workspace.`,
      filePath,
      'dynamic-expression',
      { expressionType: possibleOverride.type }
    );
  }
  return unwrapExpression(workspaceProperty['value'] as AstNode);
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
  const expression = unwrapExpression(declaration);
  if (expression.type !== 'CallExpression') {
    return expression;
  }
  const callee = expression['callee'] as AstNode | undefined;
  const args =
    (expression['arguments'] as readonly AstNode[] | undefined) ?? [];
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
      { expressionType: expression.type }
    );
  }
  return unwrapExpression(args[0] as AstNode);
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
  sourceCode: string,
  parsePath = filePath
): unknown => {
  const parsed = parseWithDiagnostics(parsePath, sourceCode);
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
  const workspaceNode = findWorkspaceNode(configObject, filePath);
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

const yamlKeyName = (value: unknown): string | null => {
  if (!isScalar(value)) {
    return null;
  }
  const scalar = value.value;
  return typeof scalar === 'string' ||
    typeof scalar === 'number' ||
    typeof scalar === 'boolean' ||
    typeof scalar === 'bigint' ||
    scalar === null
    ? String(scalar)
    : null;
};

const yamlUniqueEntry = (
  value: unknown,
  key: string,
  label: string,
  filePath: string
): unknown => {
  if (!isMap(value)) {
    return undefined;
  }
  const matches = value.items.filter((pair) => yamlKeyName(pair.key) === key);
  if (matches.length > 1) {
    throw staticIdentityError(
      `${label} declares "${key}" more than once in ${filePath}.`,
      filePath,
      'invalid-shape',
      { key }
    );
  }
  return matches[0]?.value;
};

const assertYamlIdentityKeysUnique = (
  filePath: string,
  sourceCode: string
): void => {
  const document = parseDocument(sourceCode, { uniqueKeys: false });
  const workspaceNode = yamlUniqueEntry(
    document.contents,
    'workspace',
    'The default config object',
    filePath
  );
  const appsNode = yamlUniqueEntry(
    workspaceNode,
    'apps',
    'workspace',
    filePath
  );
  if (!isMap(appsNode)) {
    return;
  }
  const appIds = new Set<string>();
  for (const pair of appsNode.items) {
    const appId = yamlKeyName(pair.key);
    if (appId === null) {
      continue;
    }
    if (appIds.has(appId)) {
      throw staticIdentityError(
        `workspace.apps declares "${appId}" more than once in ${filePath}.`,
        filePath,
        'invalid-shape',
        { key: appId }
      );
    }
    appIds.add(appId);
    yamlUniqueEntry(pair.value, 'root', `workspace.apps.${appId}`, filePath);
    yamlUniqueEntry(pair.value, 'entry', `workspace.apps.${appId}`, filePath);
  }
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
        parseTrailsConfigData(filePath, text);
        return {
          workspace: extractWorkspaceFromModule(
            filePath,
            `export default (${text});`,
            `${filePath}.ts`
          ),
        };
      }
      case '.jsonc': {
        parseTrailsConfigData(filePath, text);
        return {
          workspace: extractWorkspaceFromModule(
            filePath,
            `export default (${text});`,
            `${filePath}.ts`
          ),
        };
      }
      case '.toml': {
        return parseTrailsConfigData(filePath, text);
      }
      case '.yaml': {
        const parsed = parseTrailsConfigData(filePath, text);
        assertYamlIdentityKeysUnique(filePath, text);
        return parsed;
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
