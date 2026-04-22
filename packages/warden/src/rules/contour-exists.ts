import {
  collectContourDefinitionIds,
  collectImportAliasMap,
  collectNamedContourIds,
  extractFirstStringArg,
  findConfigProperty,
  findTrailDefinitions,
  identifierName,
  offsetToLine,
  parse,
  deriveContourIdentifierName,
} from './ast.js';
import type { AstNode, TrailDefinition } from './ast.js';
import { mergeKnownContourIds } from './contour-ids.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const isContourCall = (node: AstNode): boolean =>
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) ===
    'contour';

const getContourElements = (config: AstNode): readonly AstNode[] => {
  const contoursProp = findConfigProperty(config, 'contours');
  if (!contoursProp) {
    return [];
  }

  const arrayNode = contoursProp.value;
  if (!arrayNode || (arrayNode as AstNode).type !== 'ArrayExpression') {
    return [];
  }

  const elements = (arrayNode as AstNode)['elements'] as
    | readonly AstNode[]
    | undefined;
  return elements ?? [];
};

const resolveDeclaredContourName = (
  element: AstNode,
  contourIdsByName: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>
): string | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return name
      ? deriveContourIdentifierName(
          name,
          contourIdsByName,
          knownContourIds,
          importAliases
        )
      : null;
  }

  return isContourCall(element) ? extractFirstStringArg(element) : null;
};

const extractDeclaredContourNames = (
  config: AstNode,
  contourIdsByName: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>,
  importAliases?: ReadonlyMap<string, string>
): readonly string[] => [
  ...new Set(
    getContourElements(config).flatMap((element) => {
      const contourName = resolveDeclaredContourName(
        element,
        contourIdsByName,
        knownContourIds,
        importAliases
      );
      return contourName ? [contourName] : [];
    })
  ),
];

const buildMissingContourDiagnostic = (
  trailId: string,
  contourName: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" declares contour "${contourName}" which is not defined in the project.`,
  rule: 'contour-exists',
  severity: 'error',
});

const buildDiagnosticsForDefinition = (
  definition: TrailDefinition,
  sourceCode: string,
  filePath: string,
  knownContourIds: ReadonlySet<string>,
  contourIdsByName: ReadonlyMap<string, string>,
  importAliases: ReadonlyMap<string, string>
): readonly WardenDiagnostic[] => {
  if (definition.kind !== 'trail') {
    return [];
  }

  const line = offsetToLine(sourceCode, definition.start);
  return extractDeclaredContourNames(
    definition.config,
    contourIdsByName,
    knownContourIds,
    importAliases
  ).flatMap((contourName) =>
    knownContourIds.has(contourName)
      ? []
      : [
          buildMissingContourDiagnostic(
            definition.id,
            contourName,
            filePath,
            line
          ),
        ]
  );
};

const buildContourDiagnostics = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownContourIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const contourIdsByName = collectNamedContourIds(ast);
  const importAliases = collectImportAliasMap(ast);

  return findTrailDefinitions(ast).flatMap((definition) =>
    buildDiagnosticsForDefinition(
      definition,
      sourceCode,
      filePath,
      knownContourIds,
      contourIdsByName,
      importAliases
    )
  );
};

const checkContourDeclarations = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownContourIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  return buildContourDiagnostics(ast, sourceCode, filePath, knownContourIds);
};

/**
 * Checks that every contour declared in a trail `contours` array resolves to a
 * known contour definition.
 */
export const contourExists: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return checkContourDeclarations(
      ast,
      sourceCode,
      filePath,
      collectContourDefinitionIds(ast)
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

    const localContourIds = collectContourDefinitionIds(ast);
    return checkContourDeclarations(
      ast,
      sourceCode,
      filePath,
      mergeKnownContourIds(localContourIds, context.knownContourIds)
    );
  },
  description:
    'Ensure every contour declared on a trail resolves to a known contour definition.',
  name: 'contour-exists',
  severity: 'error',
};
