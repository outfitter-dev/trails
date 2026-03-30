/**
 * Validates that service access matches the declared `services` array.
 *
 * Statically analyzes trail run functions to find `db.from(ctx)` and
 * `ctx.service('db.main')` calls and compares them against the declared
 * `services: [...]` array in the trail config. Reports errors for undeclared
 * access and warnings for unused declarations.
 */

import {
  collectNamedServiceIds,
  extractFirstStringArg,
  findConfigProperty,
  findRunBodies,
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
// Service declaration extraction
// ---------------------------------------------------------------------------

interface DeclaredService {
  readonly id: string | null;
  readonly name: string | null;
}

interface CalledServices {
  readonly fromNames: ReadonlySet<string>;
  readonly lookupIds: ReadonlySet<string>;
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

/** Check if a node is an inline `service('id', ...)` call. */
const isInlineServiceCall = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  return (
    identifierName((node as unknown as { callee?: AstNode }).callee) ===
    'service'
  );
};

/** Get `services` array elements from a trail config. */
const getServiceElements = (config: AstNode): readonly AstNode[] => {
  const servicesProp = findConfigProperty(config, 'services');
  if (!servicesProp) {
    return [];
  }

  const arrayNode = servicesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

/** Extract one declared service from a `services` array element. */
const extractDeclaredService = (
  element: AstNode,
  serviceIdsByName: ReadonlyMap<string, string>
): DeclaredService | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return {
      id: name ? (serviceIdsByName.get(name) ?? null) : null,
      name,
    };
  }

  if (isStringLiteral(element)) {
    return { id: getStringValue(element), name: null };
  }

  if (isInlineServiceCall(element)) {
    return { id: extractFirstStringArg(element), name: null };
  }

  return null;
};

/** Extract declared services from a trail config's `services` array. */
const extractDeclaredServices = (
  config: AstNode,
  serviceIdsByName: ReadonlyMap<string, string>
): readonly DeclaredService[] => {
  const elements = getServiceElements(config);

  const declared: DeclaredService[] = [];

  for (const element of elements) {
    const service = extractDeclaredService(element, serviceIdsByName);
    if (service) {
      declared.push(service);
    }
  }

  return declared;
};

// ---------------------------------------------------------------------------
// Called service extraction
// ---------------------------------------------------------------------------

/** Extract the second parameter name from a run function node. */
const extractContextParamName = (runBody: AstNode): string | null => {
  const params = runBody['params'] as readonly AstNode[] | undefined;
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

/** Extract `db.from(ctx)` object names. */
const extractFromCallName = (
  node: AstNode,
  ctxNames: ReadonlySet<string>
): string | null => {
  const callee = extractCallCallee(node);
  if (!callee) {
    return null;
  }

  const pair = extractMemberPair(callee);
  if (!pair || pair.propName !== 'from') {
    return null;
  }

  const ctxName = extractFirstIdentifierArg(node);

  return ctxName && ctxNames.has(ctxName) ? pair.objName : null;
};

/** Check if a callee is a member-style `ctx.service(...)` call. */
const isMemberServiceCall = (
  callee: AstNode,
  ctxNames: ReadonlySet<string>
): boolean => {
  const pair = extractMemberPair(callee);
  return !!pair && ctxNames.has(pair.objName) && pair.propName === 'service';
};

/** Extract `ctx.service('id')` and destructured `service('id')` lookup IDs. */
const extractLookupServiceId = (
  node: AstNode,
  ctxNames: ReadonlySet<string>,
  serviceAliases: ReadonlySet<string>
): string | null => {
  const callee = extractCallCallee(node);
  if (!callee) {
    return null;
  }

  if (isMemberServiceCall(callee, ctxNames)) {
    return extractFirstStringArg(node);
  }

  if (serviceAliases.has(identifierName(callee) ?? '')) {
    return extractFirstStringArg(node);
  }

  return null;
};

/** Collect local aliases for the service accessor (e.g. `const { service } = ctx`). */
const collectServiceAliases = (
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
      if (keyName !== 'service') {
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

/** Walk run bodies and collect service access that can be resolved statically. */
const extractCalledServices = (config: AstNode): CalledServices => {
  const fromNames = new Set<string>();
  const lookupIds = new Set<string>();

  for (const body of findRunBodies(config)) {
    const ctxNames = buildCtxNames(body);
    const serviceAliases = collectServiceAliases(body, ctxNames);

    walkScope(body, (node) => {
      const fromName = extractFromCallName(node, ctxNames);
      if (fromName) {
        fromNames.add(fromName);
      }

      const lookupId = extractLookupServiceId(node, ctxNames, serviceAliases);
      if (lookupId) {
        lookupIds.add(lookupId);
      }
    });
  }

  return { fromNames, lookupIds };
};

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

const renderDeclaredService = (service: DeclaredService): string =>
  service.name ?? service.id ?? '<unknown>';

const buildUndeclaredFromDiagnostic = (
  trailId: string,
  serviceName: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ${serviceName}.from(ctx) called but '${serviceName}' is not declared in services`,
  rule: 'service-declarations',
  severity: 'error',
});

const buildUndeclaredLookupDiagnostic = (
  trailId: string,
  serviceId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": ctx.service('${serviceId}') called but '${serviceId}' is not declared in services`,
  rule: 'service-declarations',
  severity: 'error',
});

const buildUnusedDiagnostic = (
  trailId: string,
  declaredService: DeclaredService,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}": '${renderDeclaredService(declaredService)}' declared in services but never used`,
  rule: 'service-declarations',
  severity: 'warn',
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

const serviceWasUsed = (
  declaredService: DeclaredService,
  calledServices: CalledServices
): boolean => {
  if (
    declaredService.name &&
    calledServices.fromNames.has(declaredService.name)
  ) {
    return true;
  }

  if (declaredService.id && calledServices.lookupIds.has(declaredService.id)) {
    return true;
  }

  return false;
};

const buildDeclaredNames = (
  declaredServices: readonly DeclaredService[]
): ReadonlySet<string> =>
  new Set(
    declaredServices.flatMap((service) => (service.name ? [service.name] : []))
  );

const buildDeclaredIds = (
  declaredServices: readonly DeclaredService[]
): ReadonlySet<string> =>
  new Set(
    declaredServices.flatMap((service) => (service.id ? [service.id] : []))
  );

const reportUndeclaredFromCalls = (
  trailId: string,
  filePath: string,
  line: number,
  calledServices: CalledServices,
  declaredNames: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const serviceName of calledServices.fromNames) {
    if (!declaredNames.has(serviceName)) {
      diagnostics.push(
        buildUndeclaredFromDiagnostic(trailId, serviceName, filePath, line)
      );
    }
  }
};

const reportUndeclaredLookupCalls = (
  trailId: string,
  filePath: string,
  line: number,
  calledServices: CalledServices,
  declaredIds: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const serviceId of calledServices.lookupIds) {
    if (!declaredIds.has(serviceId)) {
      diagnostics.push(
        buildUndeclaredLookupDiagnostic(trailId, serviceId, filePath, line)
      );
    }
  }
};

const reportUnusedDeclarations = (
  trailId: string,
  filePath: string,
  line: number,
  declaredServices: readonly DeclaredService[],
  calledServices: CalledServices,
  diagnostics: WardenDiagnostic[]
): void => {
  for (const declaredService of declaredServices) {
    if (serviceWasUsed(declaredService, calledServices)) {
      continue;
    }

    if (declaredService.name && declaredService.id === null) {
      continue;
    }

    diagnostics.push(
      buildUnusedDiagnostic(trailId, declaredService, filePath, line)
    );
  }
};

const hasNoServiceActivity = (
  declaredServices: readonly DeclaredService[],
  calledServices: CalledServices
): boolean =>
  declaredServices.length === 0 &&
  calledServices.fromNames.size === 0 &&
  calledServices.lookupIds.size === 0;

const analyzeTrailServices = (
  def: { config: AstNode; start: number },
  sourceCode: string,
  serviceIdsByName: ReadonlyMap<string, string>
): {
  readonly calledServices: CalledServices;
  readonly declaredIds: ReadonlySet<string>;
  readonly declaredNames: ReadonlySet<string>;
  readonly declaredServices: readonly DeclaredService[];
  readonly line: number;
} => {
  const declaredServices = extractDeclaredServices(
    def.config,
    serviceIdsByName
  );
  return {
    calledServices: extractCalledServices(def.config),
    declaredIds: buildDeclaredIds(declaredServices),
    declaredNames: buildDeclaredNames(declaredServices),
    declaredServices,
    line: offsetToLine(sourceCode, def.start),
  };
};

const checkTrailDefinition = (
  def: { id: string; config: AstNode; start: number },
  filePath: string,
  sourceCode: string,
  serviceIdsByName: ReadonlyMap<string, string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const { calledServices, declaredIds, declaredNames, declaredServices, line } =
    analyzeTrailServices(def, sourceCode, serviceIdsByName);

  if (hasNoServiceActivity(declaredServices, calledServices)) {
    return;
  }

  reportUndeclaredFromCalls(
    def.id,
    filePath,
    line,
    calledServices,
    declaredNames,
    diagnostics
  );
  reportUndeclaredLookupCalls(
    def.id,
    filePath,
    line,
    calledServices,
    declaredIds,
    diagnostics
  );
  reportUnusedDeclarations(
    def.id,
    filePath,
    line,
    declaredServices,
    calledServices,
    diagnostics
  );
};

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

/**
 * Validates that service access aligns with declared `services` arrays.
 */
export const serviceDeclarations: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const diagnostics: WardenDiagnostic[] = [];
    const serviceIdsByName = collectNamedServiceIds(ast);

    for (const def of findTrailDefinitions(ast)) {
      checkTrailDefinition(
        def,
        filePath,
        sourceCode,
        serviceIdsByName,
        diagnostics
      );
    }

    return diagnostics;
  },
  description:
    'Ensure service.from(ctx) and ctx.service() calls match the declared services array in trail definitions.',
  name: 'service-declarations',
  severity: 'error',
};
