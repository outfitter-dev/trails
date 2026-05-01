import type { Intent } from '@ontrails/core';
import {
  collectNamedTrailIds,
  collectTrailIntentsById,
  extractDefinitionCrossTargetIds,
  findTrailDefinitions,
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

const buildIntentPropagationDiagnostic = (
  trailId: string,
  targetTrailId: string,
  targetIntent: Exclude<Intent, 'read'>,
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
  trailIntentsById: ReadonlyMap<string, Intent>
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
  trailIntentsById: ReadonlyMap<string, Intent>
): readonly WardenDiagnostic[] => {
  if (def.kind !== 'trail' || trailIntentsById.get(def.id) !== 'read') {
    return [];
  }

  return buildDiagnosticsForCrossTargets(
    def.id,
    extractDefinitionCrossTargetIds(def.config, sourceCode, namedTrailIds),
    filePath,
    offsetToLine(sourceCode, def.start),
    trailIntentsById
  );
};

const checkIntentPropagation = (
  ast: AstNode | null,
  sourceCode: string,
  filePath: string,
  trailIntentsById: ReadonlyMap<string, Intent>
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
      ast ? collectTrailIntentsById(ast) : new Map<string, Intent>()
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
      : new Map<string, Intent>();
    const trailIntentsById = new Map(localTrailIntentsById);
    for (const [trailId, intent] of context.trailIntentsById ?? []) {
      trailIntentsById.set(trailId, intent);
    }
    return checkIntentPropagation(ast, sourceCode, filePath, trailIntentsById);
  },
  description:
    "Warn when a trail declaring intent: 'read' crosses a trail whose normalized intent is write or destroy.",
  name: 'intent-propagation',
  severity: 'warn',
};
