import {
  buildUserNamespaceContext,
  collectEntityDefinitionIds,
  collectImportAliasMap,
  collectNamedEntityIds,
  deriveEntityIdentifierName,
  extractFirstStringArg,
  findConfigProperty,
  findTrailDefinitions,
  getNodeCallee,
  getNodeObject,
  getNodeProperty,
  identifierName,
  isMemberAccessNonComputed,
  isUserNamespaceReceiverAllowed,
  offsetToLine,
  parse,
} from './ast.js';
import type { AstNode, TrailDefinition, UserNamespaceContext } from './ast.js';
import { mergeKnownEntityIds } from './entity-ids.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const isEntityCall = (node: AstNode): boolean =>
  node.type === 'CallExpression' &&
  identifierName(getNodeCallee(node)) === 'entity';

const getEntityElements = (config: AstNode): readonly AstNode[] => {
  const entitiesProp = findConfigProperty(config, 'entities');
  if (!entitiesProp) {
    return [];
  }

  const arrayNode = entitiesProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

/**
 * Resolve `entities.user` to its entity name. When `userNamespace` carries a
 * scope-aware `safeMemberStarts` set, the member access must appear in it —
 * rejecting cases where `entities` is shadowed by a local binding such as a
 * function parameter or `const entities = ...`. Without the set, falls back
 * to the bare name check for backward compatibility.
 */
const resolveNamespaceMemberEntityName = (
  element: AstNode,
  userNamespace: UserNamespaceContext
): string | null => {
  if (!isMemberAccessNonComputed(element)) {
    return null;
  }
  const object = getNodeObject(element);
  const property = getNodeProperty(element);
  const receiver = object ? identifierName(object) : null;
  if (
    !receiver ||
    !isUserNamespaceReceiverAllowed(receiver, element.start, userNamespace)
  ) {
    return null;
  }
  return property ? identifierName(property) : null;
};

const resolveDeclaredEntityName = (
  element: AstNode,
  entityIdsByName: ReadonlyMap<string, string>,
  knownEntityIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  userNamespace?: UserNamespaceContext
): string | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return name
      ? deriveEntityIdentifierName(
          name,
          entityIdsByName,
          knownEntityIds,
          importAliases
        )
      : null;
  }

  if (userNamespace && userNamespace.bindings.size > 0) {
    const namespaceTarget = resolveNamespaceMemberEntityName(
      element,
      userNamespace
    );
    if (namespaceTarget) {
      return namespaceTarget;
    }
  }

  return isEntityCall(element) ? extractFirstStringArg(element) : null;
};

const extractDeclaredEntityNames = (
  config: AstNode,
  entityIdsByName: ReadonlyMap<string, string>,
  knownEntityIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>,
  userNamespace?: UserNamespaceContext
): readonly string[] => [
  ...new Set(
    getEntityElements(config).flatMap((element) => {
      const entityName = resolveDeclaredEntityName(
        element,
        entityIdsByName,
        knownEntityIds,
        importAliases,
        userNamespace
      );
      return entityName ? [entityName] : [];
    })
  ),
];

const buildMissingEntityDiagnostic = (
  trailId: string,
  entityName: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" declares entity "${entityName}" which is not defined in the project. Define it with entity('${entityName}', ...) and include it in the topo, or fix the entities entry if this is a typo.`,
  rule: 'entity-exists',
  severity: 'error',
});

const buildDiagnosticsForDefinition = (
  definition: TrailDefinition,
  sourceCode: string,
  filePath: string,
  knownEntityIds: ReadonlySet<string>,
  entityIdsByName: ReadonlyMap<string, string>,
  importAliases: ReadonlyMap<string, string>,
  userNamespace: UserNamespaceContext
): readonly WardenDiagnostic[] => {
  if (definition.kind !== 'trail') {
    return [];
  }

  const line = offsetToLine(sourceCode, definition.start);
  return extractDeclaredEntityNames(
    definition.config,
    entityIdsByName,
    knownEntityIds,
    importAliases,
    userNamespace
  ).flatMap((entityName) =>
    knownEntityIds.has(entityName)
      ? []
      : [
          buildMissingEntityDiagnostic(
            definition.id,
            entityName,
            filePath,
            line
          ),
        ]
  );
};

const buildEntityDiagnostics = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownEntityIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const entityIdsByName = collectNamedEntityIds(ast);
  const importAliases = collectImportAliasMap(ast);
  const userNamespace = buildUserNamespaceContext(ast);

  return findTrailDefinitions(ast).flatMap((definition) =>
    buildDiagnosticsForDefinition(
      definition,
      sourceCode,
      filePath,
      knownEntityIds,
      entityIdsByName,
      importAliases,
      userNamespace
    )
  );
};

const checkEntityDeclarations = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownEntityIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  return buildEntityDiagnostics(ast, sourceCode, filePath, knownEntityIds);
};

/**
 * Checks that every entity declared in a trail `entities` array resolves to a
 * known entity definition.
 */
export const entityExists: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return checkEntityDeclarations(
      ast,
      sourceCode,
      filePath,
      collectEntityDefinitionIds(ast)
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const localEntityIds = collectEntityDefinitionIds(ast);
    return checkEntityDeclarations(
      ast,
      sourceCode,
      filePath,
      mergeKnownEntityIds(localEntityIds, context.knownEntityIds)
    );
  },
  description:
    'Ensure every entity declared on a trail resolves to a known entity definition.',
  name: 'entity-exists',
  severity: 'error',
};
