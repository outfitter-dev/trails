/**
 * Prefers static resource definition helpers over dynamic context lookups.
 *
 * The rule intentionally stays advisory and narrow: it only warns when the
 * trail already has a statically declared resource definition in `resources`.
 * Dynamic IDs and generic framework internals remain outside its scope.
 */

import { collectNamedResourceIds } from './source/resources.js';
import {
  extractFirstStringArg,
  findConfigProperty,
  findImplementationBodies,
  findTrailDefinitions,
  getNodeCallee,
  getNodeId,
  getNodeImported,
  getNodeInit,
  getNodeKey,
  getNodeLeft,
  getNodeLocal,
  getNodeObject,
  getNodeProperty,
  getNodeSource,
  getNodeValue,
  getNodeValueNode,
  getStringValue,
  identifierName,
  isStringLiteral,
  offsetToLine,
  parse,
  walk,
  walkScope,
  walkWithScopes,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import { isFrameworkInternalFile, isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'static-resource-accessor-preference';

const MEMBER_TYPES = new Set(['StaticMemberExpression', 'MemberExpression']);

const NAMED_DEPENDENCY_CONSTRUCTORS = new Map<string, ReadonlySet<string>>([
  ['@prisma/client', new Set(['PrismaClient'])],
  ['pg', new Set(['Pool', 'Client'])],
  ['mongodb', new Set(['MongoClient'])],
  ['ioredis', new Set(['Redis'])],
]);

interface DeclaredStaticResource {
  readonly id: string | null;
  readonly name: string;
}

interface ResourceLookup {
  readonly id: string | null;
  readonly name: string | null;
  readonly rendered: string;
  readonly shadowedDeclaredNames: ReadonlySet<string>;
  readonly start: number;
}

interface InlineDependencyConstruction {
  readonly name: string;
  readonly rendered: string;
  readonly start: number;
}

const isShadowedModuleBinding = (
  name: string | null,
  scopes: readonly ReadonlySet<string>[]
): boolean => {
  if (!name) {
    return false;
  }
  for (let i = 0; i < scopes.length - 1; i += 1) {
    const frame = scopes[i];
    if (frame?.has(name)) {
      return true;
    }
  }
  return false;
};

const extractMemberPair = (
  callee: AstNode
): { readonly objName: string; readonly propName: string } | null => {
  if (!MEMBER_TYPES.has(callee.type)) {
    return null;
  }

  const objName = identifierName(getNodeObject(callee));
  const propName = identifierName(getNodeProperty(callee));

  return objName && propName ? { objName, propName } : null;
};

const getResourceElements = (config: AstNode): readonly AstNode[] => {
  const resourcesProp = findConfigProperty(config, 'resources');
  if (!resourcesProp) {
    return [];
  }

  const arrayNode = resourcesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  return (
    ((arrayNode as AstNode)['elements'] as readonly AstNode[] | undefined) ?? []
  );
};

const extractDeclaredStaticResources = (
  config: AstNode,
  resourceIdsByName: ReadonlyMap<string, string>
): readonly DeclaredStaticResource[] =>
  getResourceElements(config).flatMap((element) => {
    if (element.type !== 'Identifier') {
      return [];
    }

    const name = identifierName(element);
    return name ? [{ id: resourceIdsByName.get(name) ?? null, name }] : [];
  });

const extractContextParamNode = (
  implementationBody: AstNode
): AstNode | null => {
  const params = implementationBody['params'] as readonly AstNode[] | undefined;
  if (!params || params.length < 2) {
    return null;
  }
  return params[1] ?? null;
};

const extractContextParamName = (
  implementationBody: AstNode
): string | null => {
  const param = extractContextParamNode(implementationBody);
  if (!param) {
    return null;
  }
  if (param.type === 'AssignmentPattern') {
    return identifierName(getNodeLeft(param));
  }
  return identifierName(param);
};

const extractResourceAlias = (property: AstNode): string | null => {
  if (property.type !== 'Property') {
    return null;
  }

  const keyName = identifierName(getNodeKey(property));
  if (keyName !== 'resource') {
    return null;
  }

  return identifierName(getNodeValueNode(property)) ?? keyName;
};

const collectParamResourceAliases = (body: AstNode): ReadonlySet<string> => {
  const param = extractContextParamNode(body);
  if (!param || param.type !== 'ObjectPattern') {
    return new Set();
  }

  const aliases = new Set<string>();
  const properties = param['properties'] as readonly AstNode[] | undefined;
  for (const property of properties ?? []) {
    const alias = extractResourceAlias(property);
    if (alias) {
      aliases.add(alias);
    }
  }
  return aliases;
};

const buildCtxNames = (body: AstNode): ReadonlySet<string> => {
  const ctxNames = new Set<string>();
  const paramName = extractContextParamName(body);
  if (paramName) {
    ctxNames.add(paramName);
  }
  return ctxNames;
};

const extractObjectPatternAliases = (
  pattern: AstNode | undefined
): readonly string[] => {
  if (pattern?.type !== 'ObjectPattern') {
    return [];
  }

  const properties = pattern['properties'] as readonly AstNode[] | undefined;
  return (properties ?? []).flatMap((property) => {
    const alias = extractResourceAlias(property);
    return alias ? [alias] : [];
  });
};

const collectResourceAliases = (
  body: AstNode,
  ctxNames: ReadonlySet<string>
): ReadonlySet<string> => {
  const aliases = new Set<string>();

  walkScope(body, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const id = getNodeId(node);
    const init = getNodeInit(node);
    const initName = identifierName(init);
    if (!initName || !ctxNames.has(initName)) {
      return;
    }

    for (const alias of extractObjectPatternAliases(id)) {
      aliases.add(alias);
    }
  });

  return aliases;
};

const extractCallCallee = (node: AstNode): AstNode | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  return (getNodeCallee(node) ?? null) as AstNode | null;
};

const extractFirstArg = (node: AstNode): AstNode | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  const args = node['arguments'] as readonly AstNode[] | undefined;
  return args?.[0] ?? null;
};

const renderStringArg = (value: string): string =>
  `'${value.replaceAll("'", "\\'")}'`;

const renderResourceArg = (node: AstNode | null): string | null => {
  if (!node) {
    return null;
  }
  const name = identifierName(node);
  if (name) {
    return name;
  }
  return isStringLiteral(node)
    ? renderStringArg(getStringValue(node) ?? '')
    : null;
};

const extractFirstIdentifierArg = (node: AstNode): string | null =>
  identifierName(extractFirstArg(node) ?? undefined);

const isMemberResourceCall = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>
): { readonly ctxName: string } | null => {
  const pair = extractMemberPair(callee);
  return pair && ctxNames.has(pair.objName) && pair.propName === 'resource'
    ? { ctxName: pair.objName }
    : null;
};

const extractResourceLookup = (
  node: AstNode,
  ctxNames: ReadonlySet<string>,
  resourceAliases: ReadonlySet<string>
): ResourceLookup | null => {
  const callee = extractCallCallee(node);
  if (!callee) {
    return null;
  }

  const arg = extractFirstArg(node);
  const renderedArg = renderResourceArg(arg);
  if (!renderedArg) {
    return null;
  }

  const memberCall = isMemberResourceCall(callee, ctxNames);
  if (memberCall) {
    return {
      id: extractFirstStringArg(node),
      name: extractFirstIdentifierArg(node),
      rendered: `${memberCall.ctxName}.resource(${renderedArg})`,
      shadowedDeclaredNames: new Set(),
      start: node.start,
    };
  }

  const calleeName = identifierName(callee);
  if (calleeName && resourceAliases.has(calleeName)) {
    return {
      id: extractFirstStringArg(node),
      name: extractFirstIdentifierArg(node),
      rendered: `${calleeName}(${renderedArg})`,
      shadowedDeclaredNames: new Set(),
      start: node.start,
    };
  }

  return null;
};

const buildDeclaredNameSet = (
  resources: readonly DeclaredStaticResource[]
): ReadonlySet<string> => new Set(resources.map((resource) => resource.name));

const collectShadowedNames = (
  names: ReadonlySet<string>,
  scopes: readonly ReadonlySet<string>[]
): ReadonlySet<string> => {
  const shadowed = new Set<string>();
  for (const name of names) {
    if (isShadowedModuleBinding(name, scopes)) {
      shadowed.add(name);
    }
  }
  return shadowed;
};

const buildDeclaredNameById = (
  resources: readonly DeclaredStaticResource[]
): ReadonlyMap<string, string> =>
  new Map(
    resources.flatMap((resource) =>
      resource.id ? [[resource.id, resource.name] as const] : []
    )
  );

const collectResourceLookups = (
  config: AstNode,
  declaredNames: ReadonlySet<string>
): readonly ResourceLookup[] => {
  const lookups: ResourceLookup[] = [];

  for (const body of findImplementationBodies(config)) {
    const ctxNames = buildCtxNames(body);
    const resourceAliases = new Set([
      ...collectParamResourceAliases(body),
      ...collectResourceAliases(body, ctxNames),
    ]);

    walkWithScopes(
      body,
      (node, scopes) => {
        const lookup = extractResourceLookup(node, ctxNames, resourceAliases);
        if (lookup && !isShadowedModuleBinding(lookup.name, scopes)) {
          lookups.push({
            ...lookup,
            shadowedDeclaredNames: collectShadowedNames(declaredNames, scopes),
          });
        }
      },
      {
        initialScopes: [declaredNames],
        stopAtNestedFunctions: true,
      }
    );
  }

  return lookups;
};

const getImportSourceValue = (node: AstNode): string | null => {
  const sourceNode = getNodeSource(node);
  const value = sourceNode ? getNodeValue(sourceNode) : null;
  return typeof value === 'string' ? value : null;
};

const addNamedDependencyConstructors = (
  source: string,
  specifier: AstNode,
  constructors: Set<string>
): void => {
  if (specifier.type !== 'ImportSpecifier') {
    return;
  }

  const imported = getNodeImported(specifier);
  const local = getNodeLocal(specifier);
  const importedName =
    identifierName(imported) ??
    (imported && isStringLiteral(imported) ? getStringValue(imported) : null);
  const localName = identifierName(local);
  if (!importedName || !localName) {
    return;
  }

  if (
    source.startsWith('@aws-sdk/client-') &&
    importedName.endsWith('Client')
  ) {
    constructors.add(localName);
    return;
  }

  const names = NAMED_DEPENDENCY_CONSTRUCTORS.get(source);
  if (names?.has(importedName)) {
    constructors.add(localName);
  }
};

const addDefaultDependencyConstructors = (
  source: string,
  specifier: AstNode,
  constructors: Set<string>
): void => {
  if (specifier.type !== 'ImportDefaultSpecifier' || source !== 'ioredis') {
    return;
  }

  const localName = identifierName(getNodeLocal(specifier));
  if (localName) {
    constructors.add(localName);
  }
};

const collectDependencyConstructors = (ast: AstNode): ReadonlySet<string> => {
  const constructors = new Set<string>();

  walk(ast, (node) => {
    if (node.type !== 'ImportDeclaration') {
      return;
    }

    const source = getImportSourceValue(node);
    if (!source) {
      return;
    }

    const specifiers = node['specifiers'] as readonly AstNode[] | undefined;
    for (const specifier of specifiers ?? []) {
      addNamedDependencyConstructors(source, specifier, constructors);
      addDefaultDependencyConstructors(source, specifier, constructors);
    }
  });

  return constructors;
};

const extractInlineDependencyConstruction = (
  node: AstNode,
  dependencyConstructors: ReadonlySet<string>
): InlineDependencyConstruction | null => {
  if (node.type !== 'NewExpression') {
    return null;
  }

  const ctorName = identifierName(getNodeCallee(node));
  return ctorName && dependencyConstructors.has(ctorName)
    ? { name: ctorName, rendered: `new ${ctorName}(...)`, start: node.start }
    : null;
};

const collectInlineDependencyConstructions = (
  config: AstNode,
  dependencyConstructors: ReadonlySet<string>
): readonly InlineDependencyConstruction[] => {
  const constructions: InlineDependencyConstruction[] = [];

  for (const body of findImplementationBodies(config)) {
    walkWithScopes(
      body,
      (node, scopes) => {
        const construction = extractInlineDependencyConstruction(
          node,
          dependencyConstructors
        );
        if (
          construction &&
          !isShadowedModuleBinding(construction.name, scopes)
        ) {
          constructions.push(construction);
        }
      },
      {
        initialScopes: [dependencyConstructors],
        stopAtNestedFunctions: true,
      }
    );
  }

  return constructions;
};

const buildAccessorDiagnostic = (
  trailId: string,
  lookup: ResourceLookup,
  resourceName: string,
  filePath: string,
  sourceCode: string
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, lookup.start),
  message:
    `Trail "${trailId}": ${lookup.rendered} uses a dynamic resource accessor ` +
    `for statically declared resource '${resourceName}'. Prefer ${resourceName}.from(ctx) ` +
    'so the dependency stays type-directed.',
  rule: RULE_NAME,
  severity: 'warn',
});

const buildInlineDependencyDiagnostic = (
  trailId: string,
  construction: InlineDependencyConstruction,
  filePath: string,
  sourceCode: string
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, construction.start),
  message:
    `Trail "${trailId}": ${construction.rendered} constructs an external dependency ` +
    'inside implementation logic. Move the client behind a resource definition and declare it in resources.',
  rule: RULE_NAME,
  severity: 'warn',
});

const reportAccessorLookups = (
  trailId: string,
  filePath: string,
  sourceCode: string,
  declaredResources: readonly DeclaredStaticResource[],
  lookups: readonly ResourceLookup[],
  diagnostics: WardenDiagnostic[]
): void => {
  const declaredNames = buildDeclaredNameSet(declaredResources);
  const declaredNameById = buildDeclaredNameById(declaredResources);

  for (const lookup of lookups) {
    const resourceName =
      (lookup.name && declaredNames.has(lookup.name) ? lookup.name : null) ??
      (lookup.id ? (declaredNameById.get(lookup.id) ?? null) : null);

    if (!resourceName) {
      continue;
    }
    if (lookup.shadowedDeclaredNames.has(resourceName)) {
      continue;
    }

    diagnostics.push(
      buildAccessorDiagnostic(
        trailId,
        lookup,
        resourceName,
        filePath,
        sourceCode
      )
    );
  }
};

const reportInlineDependencyConstructions = (
  trailId: string,
  filePath: string,
  sourceCode: string,
  constructions: readonly InlineDependencyConstruction[],
  diagnostics: WardenDiagnostic[]
): void => {
  for (const construction of constructions) {
    diagnostics.push(
      buildInlineDependencyDiagnostic(
        trailId,
        construction,
        filePath,
        sourceCode
      )
    );
  }
};

const checkTrailDefinition = (
  def: { readonly config: AstNode; readonly id: string },
  filePath: string,
  sourceCode: string,
  resourceIdsByName: ReadonlyMap<string, string>,
  dependencyConstructors: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const declaredResources = extractDeclaredStaticResources(
    def.config,
    resourceIdsByName
  );
  const lookups = collectResourceLookups(
    def.config,
    buildDeclaredNameSet(declaredResources)
  );
  reportAccessorLookups(
    def.id,
    filePath,
    sourceCode,
    declaredResources,
    lookups,
    diagnostics
  );

  const constructions = collectInlineDependencyConstructions(
    def.config,
    dependencyConstructors
  );
  reportInlineDependencyConstructions(
    def.id,
    filePath,
    sourceCode,
    constructions,
    diagnostics
  );
};

export const staticResourceAccessorPreference: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath) || isFrameworkInternalFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const resourceIdsByName = collectNamedResourceIds(ast);
    const dependencyConstructors = collectDependencyConstructors(ast);

    for (const def of findTrailDefinitions(ast)) {
      checkTrailDefinition(
        def,
        filePath,
        sourceCode,
        resourceIdsByName,
        dependencyConstructors,
        diagnostics
      );
    }

    return diagnostics;
  },
  description:
    'Prefer static resource.from(ctx) helpers over dynamic ctx.resource() lookups when the resource definition is already in scope.',
  name: RULE_NAME,
  severity: 'warn',
};
