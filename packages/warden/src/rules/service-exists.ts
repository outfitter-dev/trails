import {
  collectNamedServiceIds,
  collectServiceDefinitionIds,
  extractFirstStringArg,
  findConfigProperty,
  findTrailDefinitions,
  getStringValue,
  identifierName,
  isStringLiteral,
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

const isServiceCall = (node: AstNode): boolean =>
  node.type === 'CallExpression' &&
  identifierName((node as unknown as { callee?: AstNode }).callee) ===
    'service';

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

const extractDeclaredServiceId = (
  element: AstNode,
  serviceIdsByName: ReadonlyMap<string, string>
): string | null => {
  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return name ? (serviceIdsByName.get(name) ?? null) : null;
  }

  if (isStringLiteral(element)) {
    return getStringValue(element);
  }

  return isServiceCall(element) ? extractFirstStringArg(element) : null;
};

const extractDeclaredServiceIds = (
  config: AstNode,
  serviceIdsByName: ReadonlyMap<string, string>
): readonly string[] => [
  ...new Set(
    getServiceElements(config).flatMap((element) => {
      const id = extractDeclaredServiceId(element, serviceIdsByName);
      return id ? [id] : [];
    })
  ),
];

const buildMissingServiceDiagnostic = (
  trailId: string,
  serviceId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" declares service "${serviceId}" which is not defined in the project.`,
  rule: 'service-exists',
  severity: 'error',
});

const reportMissingServices = (
  def: { id: string; config: AstNode; start: number },
  sourceCode: string,
  serviceIdsByName: ReadonlyMap<string, string>,
  filePath: string,
  knownServiceIds: ReadonlySet<string>,
  diagnostics: WardenDiagnostic[]
): void => {
  const line = offsetToLine(sourceCode, def.start);
  for (const serviceId of extractDeclaredServiceIds(
    def.config,
    serviceIdsByName
  )) {
    if (!knownServiceIds.has(serviceId)) {
      diagnostics.push(
        buildMissingServiceDiagnostic(def.id, serviceId, filePath, line)
      );
    }
  }
};

const buildServiceDiagnostics = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownServiceIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const serviceIdsByName = collectNamedServiceIds(ast);
  for (const def of findTrailDefinitions(ast)) {
    reportMissingServices(
      def,
      sourceCode,
      serviceIdsByName,
      filePath,
      knownServiceIds,
      diagnostics
    );
  }
  return diagnostics;
};

const checkServicesExist = (
  sourceCode: string,
  filePath: string,
  knownServiceIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  return buildServiceDiagnostics(ast, sourceCode, filePath, knownServiceIds);
};

/**
 * Checks that all declared services resolve to known service definitions.
 */
export const serviceExists: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return checkServicesExist(
      sourceCode,
      filePath,
      collectServiceDefinitionIds(ast)
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    const localServiceIds = ast
      ? collectServiceDefinitionIds(ast)
      : new Set<string>();
    return checkServicesExist(
      sourceCode,
      filePath,
      context.knownServiceIds ?? localServiceIds
    );
  },
  description:
    'Ensure every service declared on a trail resolves to a known service definition.',
  name: 'service-exists',
  severity: 'error',
};
