/**
 * Validates that resource access matches the declared `resources` array.
 *
 * Statically analyzes trail `blaze` functions to find `db.from(ctx)` and
 * `ctx.resource('db.main')` calls and compares them against the declared
 * `resources: [...]` array in the trail config. Reports errors for undeclared
 * access and warnings for unused declarations.
 */

import {
  collectNamedProvisionIds,
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

interface DeclaredProvision {
  readonly id: string | null;
  readonly name: string | null;
}

interface CalledProvisions {
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
const isInlineProvisionCall = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  return (
    identifierName((node as unknown as { callee?: AstNode }).callee) ===
    'resource'
  );
};

/** Get `resources` array elements from a trail config. */
const getProvisionElements = (config: AstNode): readonly AstNode[] => {
  const provisionsProp = findConfigProperty(config, 'resources');
  if (!provisionsProp) {
    return [];
  }

  const arrayNode = provisionsProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

/** Extract one declared resource from a `resources` array element. */
const extractDeclaredProvision = (
  element: AstNode,
  provisionIdsByName: ReadonlyMap<string, string>
): DeclaredProvision | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return {
      id: name ? (provisionIdsByName.get(name) ?? null) : null,
      name,
    };
  }

  if (isStringLiteral(element)) {
    return { id: getStringValue(element), name: null };
  }

  if (isInlineProvisionCall(element)) {
    return { id: extractFirstStringArg(element), name: null };
  }

  return null;
};

/** Extract declared resources from a trail config's `resources` array. */
const extractDeclaredProvisions = (
  config: AstNode,
  provisionIdsByName: ReadonlyMap<string, string>
): readonly DeclaredProvision[] =>
  getProvisionElements(config).flatMap((element) => {
    const resource = extractDeclaredProvision(element, provisionIdsByName);
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
const isMemberProvisionCall = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>
): boolean => {
  const pair = extractMemberPair(callee);
  return !!pair && ctxNames.has(pair.objName) && pair.propName === 'resource';
};

/** Extract `ctx.resource(db)` and destructured `resource(db)` lookup names. */
const extractLookupProvisionName = (
  node: AstNode,
  ctxNames: ReadonlySet<string>,
  provisionAliases: ReadonlySet<string>
): string | null => {
  const callee = extractCallCallee(node);
  if (!callee) {
    return null;
  }

  if (isMemberProvisionCall(callee, ctxNames)) {
    return extractFirstIdentifierArg(node);
  }

  if (provisionAliases.has(identifierName(callee) ?? '')) {
    return extractFirstIdentifierArg(node);
  }

  return null;
};

/** Extract `ctx.resource('id')` and destructured `resource('id')` lookup IDs. */
const extractLookupProvisionId = (
  node: AstNode,
  ctxNames: ReadonlySet<string>,
  provisionAliases: ReadonlySet<string>
): string | null => {
  const callee = extractCallCallee(node);
  if (!callee) {
    return null;
  }

  if (isMemberProvisionCall(callee, ctxNames)) {
    return extractFirstStringArg(node);
  }

  const calleeName = identifierName(callee);
  const args = node['arguments'] as readonly AstNode[] | undefined;
  if (calleeName && provisionAliases.has(calleeName) && args?.length === 1) {
    return extractFirstStringArg(node);
  }

  return null;
};

/** Collect local aliases for the resource accessor (e.g. `const { resource } = ctx`). */
const collectProvisionAliases = (
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
const extractCalledProvisions = (config: AstNode): CalledProvisions => {
  const fromNames = new Set<string>();
  const lookupIds = new Set<string>();
  const lookupNames = new Set<string>();

  for (const body of findBlazeBodies(config)) {
    const ctxNames = buildCtxNames(body);
    const provisionAliases = collectProvisionAliases(body, ctxNames);

    walkScope(body, (node) => {
      const fromName = extractFromCallName(node, ctxNames);
      if (fromName) {
        fromNames.add(fromName);
      }

      const lookupId = extractLookupProvisionId(
        node,
        ctxNames,
        provisionAliases
      );
      if (lookupId) {
        lookupIds.add(lookupId);
      }

      const lookupName = extractLookupProvisionName(
        node,
        ctxNames,
        provisionAliases
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

const renderDeclaredProvision = (resource: DeclaredProvision): string =>
  resource.name ?? resource.id ?? '<unknown>';

const buildUndeclaredFromDiagnostic = (
  trailId: string,
  provisionName: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ${provisionName}.from(ctx) called but '${provisionName}' is not declared in resources`,
  rule: 'resource-declarations',
  severity: 'error',
});

const buildUndeclaredLookupDiagnostic = (
  trailId: string,
  provisionId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ctx.resource('${provisionId}') called but '${provisionId}' is not declared in resources`,
  rule: 'resource-declarations',
  severity: 'error',
});

const buildUndeclaredLookupNameDiagnostic = (
  trailId: string,
  provisionName: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ctx.resource(${provisionName}) called but '${provisionName}' is not declared in resources`,
  rule: 'resource-declarations',
  severity: 'error',
});

const buildUnusedDiagnostic = (
  trailId: string,
  declaredProvision: DeclaredProvision,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": '${renderDeclaredProvision(declaredProvision)}' declared in resources but never used`,
  rule: 'resource-declarations',
  severity: 'warn',
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

const provisionWasUsed = (
  declaredProvision: DeclaredProvision,
  calledProvisions: CalledProvisions
): boolean => {
  if (
    declaredProvision.name &&
    (calledProvisions.fromNames.has(declaredProvision.name) ||
      calledProvisions.lookupNames.has(declaredProvision.name))
  ) {
    return true;
  }

  if (
    declaredProvision.id &&
    calledProvisions.lookupIds.has(declaredProvision.id)
  ) {
    return true;
  }

  return false;
};

const buildDeclaredNames = (
  declaredProvisions: readonly DeclaredProvision[]
): ReadonlySet<string> =>
  new Set(
    declaredProvisions.flatMap((resource) =>
      resource.name ? [resource.name] : []
    )
  );

const buildDeclaredIds = (
  declaredProvisions: readonly DeclaredProvision[]
): ReadonlySet<string> =>
  new Set(
    declaredProvisions.flatMap((resource) => (resource.id ? [resource.id] : []))
  );

const reportUndeclaredFromCalls = (
  trailId: string,
  filePath: string,
  line: number,
  calledProvisions: CalledProvisions,
  declaredNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const provisionName of calledProvisions.fromNames) {
    if (!declaredNames.has(provisionName)) {
      diagnostics.push(
        buildUndeclaredFromDiagnostic(trailId, provisionName, filePath, line)
      );
    }
  }
};

const reportUndeclaredLookupCalls = (
  trailId: string,
  filePath: string,
  line: number,
  calledProvisions: CalledProvisions,
  declaredIds: ReadonlySet<string>,
  declaredNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const provisionName of calledProvisions.lookupNames) {
    // Name-based lookup checks remain reliable even when an imported resource ID
    // cannot be resolved locally.
    if (!declaredNames.has(provisionName)) {
      diagnostics.push(
        buildUndeclaredLookupNameDiagnostic(
          trailId,
          provisionName,
          filePath,
          line
        )
      );
    }
  }

  for (const provisionId of calledProvisions.lookupIds) {
    if (!declaredIds.has(provisionId)) {
      diagnostics.push(
        buildUndeclaredLookupDiagnostic(trailId, provisionId, filePath, line)
      );
    }
  }
};

const reportUnusedDeclarations = (
  trailId: string,
  filePath: string,
  line: number,
  declaredProvisions: readonly DeclaredProvision[],
  calledProvisions: CalledProvisions,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const declaredProvision of declaredProvisions) {
    if (provisionWasUsed(declaredProvision, calledProvisions)) {
      continue;
    }

    if (declaredProvision.name && declaredProvision.id === null) {
      continue;
    }

    diagnostics.push(
      buildUnusedDiagnostic(trailId, declaredProvision, filePath, line)
    );
  }
};

const hasNoProvisionActivity = (
  declaredProvisions: readonly DeclaredProvision[],
  calledProvisions: CalledProvisions
): boolean =>
  declaredProvisions.length === 0 &&
  calledProvisions.fromNames.size === 0 &&
  calledProvisions.lookupIds.size === 0 &&
  calledProvisions.lookupNames.size === 0;

const analyzeTrailServices = (
  def: { config: AstNode; start: number },
  sourceCode: string,
  provisionIdsByName: ReadonlyMap<string, string>
): {
  readonly calledProvisions: CalledProvisions;
  readonly declaredIds: ReadonlySet<string>;
  readonly declaredNames: ReadonlySet<string>;
  readonly declaredProvisions: readonly DeclaredProvision[];
  readonly line: number;
} => {
  const declaredProvisions = extractDeclaredProvisions(
    def.config,
    provisionIdsByName
  );
  return {
    calledProvisions: extractCalledProvisions(def.config),
    declaredIds: buildDeclaredIds(declaredProvisions),
    declaredNames: buildDeclaredNames(declaredProvisions),
    declaredProvisions,
    line: offsetToLine(sourceCode, def.start),
  };
};

const checkTrailDefinition = (
  def: { id: string; config: AstNode; start: number },
  filePath: string,
  sourceCode: string,
  provisionIdsByName: ReadonlyMap<string, string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const {
    calledProvisions,
    declaredIds,
    declaredNames,
    declaredProvisions,
    line,
  } = analyzeTrailServices(def, sourceCode, provisionIdsByName);

  if (hasNoProvisionActivity(declaredProvisions, calledProvisions)) {
    return;
  }

  reportUndeclaredFromCalls(
    def.id,
    filePath,
    line,
    calledProvisions,
    declaredNames,
    diagnostics
  );
  reportUndeclaredLookupCalls(
    def.id,
    filePath,
    line,
    calledProvisions,
    declaredIds,
    declaredNames,
    diagnostics
  );
  reportUnusedDeclarations(
    def.id,
    filePath,
    line,
    declaredProvisions,
    calledProvisions,
    diagnostics
  );
};

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

/**
 * Validates that resource access aligns with declared `resources` arrays.
 */
export const provisionDeclarations: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const provisionIdsByName = collectNamedProvisionIds(ast);

    for (const def of findTrailDefinitions(ast)) {
      checkTrailDefinition(
        def,
        filePath,
        sourceCode,
        provisionIdsByName,
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
