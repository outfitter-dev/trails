import {
  collectNamedTrailIds,
  collectTrailIntentsById,
  findConfigProperty,
  findTrailDefinitions,
  getStringValue,
  identifierName,
  isStringLiteral,
  offsetToLine,
  parse,
  resolveConstString,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

type TrailIntent = 'destroy' | 'read' | 'write';

const getCrossElements = (config: AstNode): readonly AstNode[] => {
  const crossesProp = findConfigProperty(config, 'crosses');
  if (!crossesProp) {
    return [];
  }

  const crossesValue = crossesProp.value as AstNode | undefined;
  if (!crossesValue || crossesValue.type !== 'ArrayExpression') {
    return [];
  }

  const elements = crossesValue['elements'] as readonly AstNode[] | undefined;
  return elements ?? [];
};

const getTrailCallConfigNode = (
  firstArg: AstNode,
  secondArg: AstNode | undefined
): AstNode | null => {
  if (firstArg.type === 'ObjectExpression') {
    return firstArg;
  }

  if (secondArg?.type === 'ObjectExpression') {
    return secondArg;
  }

  return null;
};

const extractTrailIdFromConfigNode = (
  configNode: AstNode | null
): string | null => {
  if (!configNode) {
    return null;
  }

  const idProp = findConfigProperty(configNode, 'id');
  const idValue = idProp?.value as AstNode | undefined;
  return idValue && isStringLiteral(idValue) ? getStringValue(idValue) : null;
};

const isInlineTrailFactoryCall = (node: AstNode): boolean =>
  identifierName((node as unknown as { callee?: AstNode }).callee) === 'trail';

const getTrailCallArgs = (
  node: AstNode
): readonly [AstNode | undefined, AstNode | undefined] => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  const [firstArg, secondArg] = args ?? [];
  return [firstArg, secondArg];
};

const extractInlineTrailId = (node: AstNode): string | null => {
  if (node.type !== 'CallExpression' || !isInlineTrailFactoryCall(node)) {
    return null;
  }

  const [firstArg, secondArg] = getTrailCallArgs(node);
  if (!firstArg) {
    return null;
  }

  return isStringLiteral(firstArg)
    ? getStringValue(firstArg)
    : extractTrailIdFromConfigNode(getTrailCallConfigNode(firstArg, secondArg));
};

const resolveCrossedTrailId = (
  element: AstNode,
  sourceCode: string,
  namedTrailIds: ReadonlyMap<string, string>
): string | null => {
  if (isStringLiteral(element)) {
    return getStringValue(element);
  }

  if (element.type === 'Identifier') {
    const name = identifierName(element);
    return name
      ? (namedTrailIds.get(name) ?? resolveConstString(name, sourceCode))
      : null;
  }

  return extractInlineTrailId(element);
};

const extractCrossTargetIds = (
  config: AstNode,
  sourceCode: string,
  namedTrailIds: ReadonlyMap<string, string>
): readonly string[] => [
  ...new Set(
    getCrossElements(config).flatMap((element) => {
      const id = resolveCrossedTrailId(element, sourceCode, namedTrailIds);
      return id ? [id] : [];
    })
  ),
];

const extractTrailIntent = (config: AstNode): TrailIntent => {
  const intentProp = findConfigProperty(config, 'intent');
  const intentValue = intentProp?.value as AstNode | undefined;
  if (!intentValue || !isStringLiteral(intentValue)) {
    return 'write';
  }

  const value = getStringValue(intentValue);
  return value === 'destroy' || value === 'read' ? value : 'write';
};

const buildIntentPropagationDiagnostic = (
  trailId: string,
  targetTrailId: string,
  targetIntent: Exclude<TrailIntent, 'read'>,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" declares intent: 'read' but crosses "${targetTrailId}" with intent: '${targetIntent}'. Read trails must not compose write or destroy side effects.`,
  rule: 'intent-propagation',
  severity: 'warn',
});

const buildDiagnosticsForCrossTargets = (
  trailId: string,
  targetTrailIds: readonly string[],
  filePath: string,
  line: number,
  trailIntentsById: ReadonlyMap<string, TrailIntent>
): readonly WardenDiagnostic[] =>
  targetTrailIds.flatMap((targetTrailId) => {
    const targetIntent = trailIntentsById.get(targetTrailId);
    if (!targetIntent || targetIntent === 'read') {
      return [];
    }

    return [
      buildIntentPropagationDiagnostic(
        trailId,
        targetTrailId,
        targetIntent,
        filePath,
        line
      ),
    ];
  });

const buildDiagnosticsForTrail = (
  def: ReturnType<typeof findTrailDefinitions>[number],
  sourceCode: string,
  filePath: string,
  namedTrailIds: ReadonlyMap<string, string>,
  trailIntentsById: ReadonlyMap<string, TrailIntent>
): readonly WardenDiagnostic[] => {
  if (def.kind !== 'trail' || extractTrailIntent(def.config) !== 'read') {
    return [];
  }

  return buildDiagnosticsForCrossTargets(
    def.id,
    extractCrossTargetIds(def.config, sourceCode, namedTrailIds),
    filePath,
    offsetToLine(sourceCode, def.start),
    trailIntentsById
  );
};

const checkIntentPropagation = (
  ast: AstNode | null,
  sourceCode: string,
  filePath: string,
  trailIntentsById: ReadonlyMap<string, TrailIntent>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath) || !ast) {
    return [];
  }

  const namedTrailIds = collectNamedTrailIds(ast);
  return findTrailDefinitions(ast).flatMap((def) =>
    buildDiagnosticsForTrail(
      def,
      sourceCode,
      filePath,
      namedTrailIds,
      trailIntentsById
    )
  );
};

export const intentPropagation: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    return checkIntentPropagation(
      ast,
      sourceCode,
      filePath,
      ast ? collectTrailIntentsById(ast) : new Map<string, TrailIntent>()
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    const localTrailIntentsById = ast
      ? collectTrailIntentsById(ast)
      : new Map<string, TrailIntent>();
    return checkIntentPropagation(
      ast,
      sourceCode,
      filePath,
      context.trailIntentsById ?? localTrailIntentsById
    );
  },
  description:
    "Warn when a trail declaring intent: 'read' crosses a trail whose normalized intent is write or destroy.",
  name: 'intent-propagation',
  severity: 'warn',
};
