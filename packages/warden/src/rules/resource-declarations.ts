/**
 * Validates that resource access matches the declared `resources` array.
 *
 * Statically analyzes trail `blaze` functions to find `db.from(ctx)` and
 * `ctx.resource('db.main')` calls and compares them against the declared
 * `resources: [...]` array in the trail config. Reports errors for undeclared
 * access and warnings for unused declarations.
 */

import {
  collectNamedResourceIds,
  extractFirstStringArg,
  findConfigProperty,
  findBlazeBodies,
  findTrailDefinitions,
  getStringValue,
  identifierName,
  isStringLiteral,
  offsetToLine,
  parse,
  walkScope,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

// ---------------------------------------------------------------------------
// Resource declaration extraction
// ---------------------------------------------------------------------------

interface DeclaredResource {
  readonly id: string | null;
  readonly name: string | null;
}

interface CalledResources {
  readonly fromNames: ReadonlySet<string>;
  readonly lookupIds: ReadonlySet<string>;
  readonly lookupNames: ReadonlySet<string>;
}

const MEMBER_TYPES = new Set(['StaticMemberExpression', 'MemberExpression']);

/** Extract object and property Identifier names from a MemberExpression. */
const extractMemberPair = (
  callee: AstNode
): { objName: string; propName: string } | null => {
  if (!MEMBER_TYPES.has(callee.type)) {
    return null;
  }

  const objName = identifierName(
    (callee as unknown as { object?: AstNode }).object
  );
  const propName = identifierName(
    (callee as unknown as { property?: AstNode }).property
  );

  return objName && propName ? { objName, propName } : null;
};

/** Check if a node is an inline `resource('id', ...)` call. */
const isInlineResourceCall = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  return (
    identifierName((node as unknown as { callee?: AstNode }).callee) ===
    'resource'
  );
};

/** Get `resources` array elements from a trail config. */
const getResourceElements = (config: AstNode): readonly AstNode[] => {
  const resourcesProp = findConfigProperty(config, 'resources');
  if (!resourcesProp) {
    return [];
  }

  const arrayNode = resourcesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

/** Extract one declared resource from a `resources` array element. */
const extractDeclaredResource = (
  element: AstNode,
  resourceIdsByName: ReadonlyMap<string, string>
): DeclaredResource | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return {
      id: name ? (resourceIdsByName.get(name) ?? null) : null,
      name,
    };
  }

  if (isStringLiteral(element)) {
    return { id: getStringValue(element), name: null };
  }

  if (isInlineResourceCall(element)) {
    return { id: extractFirstStringArg(element), name: null };
  }

  return null;
};

/** Extract declared resources from a trail config's `resources` array. */
const extractDeclaredResources = (
  config: AstNode,
  resourceIdsByName: ReadonlyMap<string, string>
): readonly DeclaredResource[] =>
  getResourceElements(config).flatMap((element) => {
    const resource = extractDeclaredResource(element, resourceIdsByName);
    return resource ? [resource] : [];
  });

// ---------------------------------------------------------------------------
// Called service extraction
// ---------------------------------------------------------------------------

/** Extract the second parameter name from a blaze function node. */
const extractContextParamName = (blazeBody: AstNode): string | null => {
  const params = blazeBody['params'] as readonly AstNode[] | undefined;
  if (!params || params.length < 2) {
    return null;
  }
  return identifierName(params[1]);
};

/** Build the set of context parameter names to match against. */
const buildCtxNames = (body: AstNode): ReadonlySet<string> => {
  const ctxNames = new Set(['ctx', 'context']);
  const paramName = extractContextParamName(body);
  if (paramName) {
    ctxNames.add(paramName);
  }
  return ctxNames;
};

/** Extract a CallExpression callee, or null. */
const extractCallCallee = (node: AstNode): AstNode | null => {
  if (node.type !== 'CallExpression') {
    return null;
  }
  return ((node as unknown as { callee?: AstNode }).callee ??
    null) as AstNode | null;
};

/** Extract the first identifier argument from a CallExpression. */
const extractFirstIdentifierArg = (node: AstNode): string | null => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  const [firstArg] = args ?? [];
  return identifierName(firstArg);
};

const extractCallInfo = (
  node: AstNode
): { callee: AstNode; firstArgName: string | null } | null => {
  const callee = extractCallCallee(node);
  return callee
    ? {
        callee,
        firstArgName: extractFirstIdentifierArg(node),
      }
    : null;
};

/** Extract `db.from(ctx)` object names. */
const extractFromCallName = (
  node: AstNode,
  ctxNames: ReadonlySet<string>
): string | null => {
  const call = extractCallInfo(node);
  const pair = call ? extractMemberPair(call.callee) : null;

  return pair &&
    pair.propName === 'from' &&
    call?.firstArgName &&
    ctxNames.has(call.firstArgName)
    ? pair.objName
    : null;
};

/** Check if a callee is a member-style `ctx.resource(...)` call. */
const isMemberResourceCall = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>
): boolean => {
  const pair = extractMemberPair(callee);
  return !!pair && ctxNames.has(pair.objName) && pair.propName === 'resource';
};

/** Extract `ctx.resource(db)` and destructured `resource(db)` lookup names. */
const extractLookupResourceName = (
  node: AstNode,
  ctxNames: ReadonlySet<string>,
  resourceAliases: ReadonlySet<string>
): string | null => {
  const callee = extractCallCallee(node);
  if (!callee) {
    return null;
  }

  if (isMemberResourceCall(callee, ctxNames)) {
    return extractFirstIdentifierArg(node);
  }

  if (resourceAliases.has(identifierName(callee) ?? '')) {
    return extractFirstIdentifierArg(node);
  }

  return null;
};

/** Extract `ctx.resource('id')` and destructured `resource('id')` lookup IDs. */
const extractLookupResourceId = (
  node: AstNode,
  ctxNames: ReadonlySet<string>,
  resourceAliases: ReadonlySet<string>
): string | null => {
  const callee = extractCallCallee(node);
  if (!callee) {
    return null;
  }

  if (isMemberResourceCall(callee, ctxNames)) {
    return extractFirstStringArg(node);
  }

  const calleeName = identifierName(callee);
  const args = node['arguments'] as readonly AstNode[] | undefined;
  if (calleeName && resourceAliases.has(calleeName) && args?.length === 1) {
    return extractFirstStringArg(node);
  }

  return null;
};

/** Collect local aliases for the resource accessor (e.g. `const { resource } = ctx`). */
const collectResourceAliases = (
  body: AstNode,
  ctxNames: ReadonlySet<string>
): ReadonlySet<string> => {
  const aliases = new Set<string>();

  const extractAliasNames = (
    pattern: AstNode | undefined
  ): readonly string[] => {
    if (pattern?.type !== 'ObjectPattern') {
      return [];
    }

    const properties = pattern['properties'] as readonly AstNode[] | undefined;
    return (properties ?? []).flatMap((property) => {
      if (property.type !== 'Property') {
        return [];
      }

      const keyName = identifierName(
        (property as unknown as { key?: AstNode }).key
      );
      if (keyName !== 'resource') {
        return [];
      }

      const alias =
        identifierName((property as unknown as { value?: AstNode }).value) ??
        keyName;
      return [alias];
    });
  };

  walkScope(body, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    const initName = identifierName(init);
    if (!initName || !ctxNames.has(initName)) {
      return;
    }

    for (const alias of extractAliasNames(id)) {
      aliases.add(alias);
    }
  });

  return aliases;
};

/** Walk blaze bodies and collect resource access that can be resolved statically. */
const extractCalledResources = (config: AstNode): CalledResources => {
  const fromNames = new Set<string>();
  const lookupIds = new Set<string>();
  const lookupNames = new Set<string>();

  for (const body of findBlazeBodies(config)) {
    const ctxNames = buildCtxNames(body);
    const resourceAliases = collectResourceAliases(body, ctxNames);

    walkScope(body, (node) => {
      const fromName = extractFromCallName(node, ctxNames);
      if (fromName) {
        fromNames.add(fromName);
      }

      const lookupId = extractLookupResourceId(node, ctxNames, resourceAliases);
      if (lookupId) {
        lookupIds.add(lookupId);
      }

      const lookupName = extractLookupResourceName(
        node,
        ctxNames,
        resourceAliases
      );
      if (lookupName) {
        lookupNames.add(lookupName);
      }
    });
  }

  return { fromNames, lookupIds, lookupNames };
};

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

const renderDeclaredResource = (resource: DeclaredResource): string =>
  resource.name ?? resource.id ?? '<unknown>';

const buildUndeclaredFromDiagnostic = (
  trailId: string,
  resourceName: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ${resourceName}.from(ctx) called but '${resourceName}' is not declared in resources`,
  rule: 'resource-declarations',
  severity: 'error',
});

const buildUndeclaredLookupDiagnostic = (
  trailId: string,
  resourceId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ctx.resource('${resourceId}') called but '${resourceId}' is not declared in resources`,
  rule: 'resource-declarations',
  severity: 'error',
});

const buildUndeclaredLookupNameDiagnostic = (
  trailId: string,
  resourceName: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ctx.resource(${resourceName}) called but '${resourceName}' is not declared in resources`,
  rule: 'resource-declarations',
  severity: 'error',
});

const buildUnusedDiagnostic = (
  trailId: string,
  declaredResource: DeclaredResource,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": '${renderDeclaredResource(declaredResource)}' declared in resources but never used`,
  rule: 'resource-declarations',
  severity: 'warn',
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

const resourceWasUsed = (
  declaredResource: DeclaredResource,
  calledResources: CalledResources
): boolean => {
  if (
    declaredResource.name &&
    (calledResources.fromNames.has(declaredResource.name) ||
      calledResources.lookupNames.has(declaredResource.name))
  ) {
    return true;
  }

  if (
    declaredResource.id &&
    calledResources.lookupIds.has(declaredResource.id)
  ) {
    return true;
  }

  return false;
};

const buildDeclaredNames = (
  declaredResources: readonly DeclaredResource[]
): ReadonlySet<string> =>
  new Set(
    declaredResources.flatMap((resource) =>
      resource.name ? [resource.name] : []
    )
  );

const buildDeclaredIds = (
  declaredResources: readonly DeclaredResource[]
): ReadonlySet<string> =>
  new Set(
    declaredResources.flatMap((resource) => (resource.id ? [resource.id] : []))
  );

const reportUndeclaredFromCalls = (
  trailId: string,
  filePath: string,
  line: number,
  calledResources: CalledResources,
  declaredNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const resourceName of calledResources.fromNames) {
    if (!declaredNames.has(resourceName)) {
      diagnostics.push(
        buildUndeclaredFromDiagnostic(trailId, resourceName, filePath, line)
      );
    }
  }
};

const reportUndeclaredLookupCalls = (
  trailId: string,
  filePath: string,
  line: number,
  calledResources: CalledResources,
  declaredIds: ReadonlySet<string>,
  declaredNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const resourceName of calledResources.lookupNames) {
    // Name-based lookup checks remain reliable even when an imported resource ID
    // cannot be resolved locally.
    if (!declaredNames.has(resourceName)) {
      diagnostics.push(
        buildUndeclaredLookupNameDiagnostic(
          trailId,
          resourceName,
          filePath,
          line
        )
      );
    }
  }

  for (const resourceId of calledResources.lookupIds) {
    if (!declaredIds.has(resourceId)) {
      diagnostics.push(
        buildUndeclaredLookupDiagnostic(trailId, resourceId, filePath, line)
      );
    }
  }
};

const reportUnusedDeclarations = (
  trailId: string,
  filePath: string,
  line: number,
  declaredResources: readonly DeclaredResource[],
  calledResources: CalledResources,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const declaredResource of declaredResources) {
    if (resourceWasUsed(declaredResource, calledResources)) {
      continue;
    }

    if (declaredResource.name && declaredResource.id === null) {
      continue;
    }

    diagnostics.push(
      buildUnusedDiagnostic(trailId, declaredResource, filePath, line)
    );
  }
};

const hasNoResourceActivity = (
  declaredResources: readonly DeclaredResource[],
  calledResources: CalledResources
): boolean =>
  declaredResources.length === 0 &&
  calledResources.fromNames.size === 0 &&
  calledResources.lookupIds.size === 0 &&
  calledResources.lookupNames.size === 0;

const analyzeTrailServices = (
  def: { config: AstNode; start: number },
  sourceCode: string,
  resourceIdsByName: ReadonlyMap<string, string>
): {
  readonly calledResources: CalledResources;
  readonly declaredIds: ReadonlySet<string>;
  readonly declaredNames: ReadonlySet<string>;
  readonly declaredResources: readonly DeclaredResource[];
  readonly line: number;
} => {
  const declaredResources = extractDeclaredResources(
    def.config,
    resourceIdsByName
  );
  return {
    calledResources: extractCalledResources(def.config),
    declaredIds: buildDeclaredIds(declaredResources),
    declaredNames: buildDeclaredNames(declaredResources),
    declaredResources,
    line: offsetToLine(sourceCode, def.start),
  };
};

const checkTrailDefinition = (
  def: { id: string; config: AstNode; start: number },
  filePath: string,
  sourceCode: string,
  resourceIdsByName: ReadonlyMap<string, string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const {
    calledResources,
    declaredIds,
    declaredNames,
    declaredResources,
    line,
  } = analyzeTrailServices(def, sourceCode, resourceIdsByName);

  if (hasNoResourceActivity(declaredResources, calledResources)) {
    return;
  }

  reportUndeclaredFromCalls(
    def.id,
    filePath,
    line,
    calledResources,
    declaredNames,
    diagnostics
  );
  reportUndeclaredLookupCalls(
    def.id,
    filePath,
    line,
    calledResources,
    declaredIds,
    declaredNames,
    diagnostics
  );
  reportUnusedDeclarations(
    def.id,
    filePath,
    line,
    declaredResources,
    calledResources,
    diagnostics
  );
};

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

/**
 * Validates that resource access aligns with declared `resources` arrays.
 */
export const resourceDeclarations: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const resourceIdsByName = collectNamedResourceIds(ast);

    for (const def of findTrailDefinitions(ast)) {
      checkTrailDefinition(
        def,
        filePath,
        sourceCode,
        resourceIdsByName,
        diagnostics
      );
    }

    return diagnostics;
  },
  description:
    'Ensure resource.from(ctx) and ctx.resource() calls match the declared resources array in trail definitions.',
  name: 'resource-declarations',
  severity: 'error',
};
