import {
  collectContourDefinitionIds,
  collectNamedContourIds,
  extractFirstStringArg,
  findConfigProperty,
  findTrailDefinitions,
  identifierName,
  offsetToLine,
  parse,
} from './ast.js';
import type { AstNode } from './ast.js';
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

const resolveContourIdentifierName = (
  name: string,
  contourIdsByName: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>
): string | null => {
  const localName = contourIdsByName.get(name);
  if (localName) {
    return localName;
  }

  if (knownContourIds?.has(name)) {
    return name;
  }

  const suffix = 'Contour';
  if (
    name.endsWith(suffix) &&
    knownContourIds?.has(name.slice(0, -suffix.length))
  ) {
    return name.slice(0, -suffix.length);
  }

  return name;
};

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
  knownContourIds?: ReadonlySet<string>
): string | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return name
      ? resolveContourIdentifierName(name, contourIdsByName, knownContourIds)
      : null;
  }

  return isContourCall(element) ? extractFirstStringArg(element) : null;
};

const extractDeclaredContourNames = (
  config: AstNode,
  contourIdsByName: ReadonlyMap<string, string>,
  knownContourIds?: ReadonlySet<string>
): readonly string[] => [
  ...new Set(
    getContourElements(config).flatMap((element) => {
      const contourName = resolveDeclaredContourName(
        element,
        contourIdsByName,
        knownContourIds
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

const buildContourDiagnostics = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownContourIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const contourIdsByName = collectNamedContourIds(ast);

  for (const definition of findTrailDefinitions(ast)) {
    if (definition.kind !== 'trail') {
      continue;
    }

    const line = offsetToLine(sourceCode, definition.start);
    for (const contourName of extractDeclaredContourNames(
      definition.config,
      contourIdsByName,
      knownContourIds
    )) {
      if (!knownContourIds.has(contourName)) {
        diagnostics.push(
          buildMissingContourDiagnostic(
            definition.id,
            contourName,
            filePath,
            line
          )
        );
      }
    }
  }

  return diagnostics;
};

const checkContourDeclarations = (
  sourceCode: string,
  filePath: string,
  knownContourIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const ast = parse(filePath, sourceCode);
  if (!ast) {
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
    const localContourIds = ast
      ? collectContourDefinitionIds(ast)
      : new Set<string>();
    return checkContourDeclarations(
      sourceCode,
      filePath,
      context.knownContourIds ?? localContourIds
    );
  },
  description:
    'Ensure every contour declared on a trail resolves to a known contour definition.',
  name: 'contour-exists',
  severity: 'error',
};
