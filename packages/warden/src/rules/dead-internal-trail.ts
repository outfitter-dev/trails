import {
  collectCrossTargetTrailIds,
  findConfigProperty,
  findTrailDefinitions,
  getStringValue,
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

const hasOnActivation = (config: AstNode): boolean => {
  const onProp = findConfigProperty(config, 'on');
  if (!onProp) {
    return false;
  }

  const onValue = onProp.value as AstNode | undefined;
  if (!onValue || onValue.type !== 'ArrayExpression') {
    return false;
  }

  const elements = onValue['elements'] as readonly AstNode[] | undefined;
  return (elements?.length ?? 0) > 0;
};

const isInternalTrail = (config: AstNode): boolean => {
  const visibilityProp = findConfigProperty(config, 'visibility');
  const visibilityValue = visibilityProp?.value as AstNode | undefined;
  return (
    !!visibilityValue &&
    isStringLiteral(visibilityValue) &&
    getStringValue(visibilityValue) === 'internal'
  );
};

const buildDeadInternalTrailDiagnostic = (
  trailId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" is marked visibility: 'internal' but nothing crosses it and it has no on: activation. Internal trails should stay reachable through ctx.cross() or reactive activation.`,
  rule: 'dead-internal-trail',
  severity: 'warn',
});

const checkDeadInternalTrails = (
  ast: AstNode | null,
  sourceCode: string,
  filePath: string,
  crossedTrailIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath) || !ast) {
    return [];
  }

  const diagnostics: WardenDiagnostic[] = [];

  for (const def of findTrailDefinitions(ast)) {
    if (def.kind !== 'trail' || !isInternalTrail(def.config)) {
      continue;
    }

    if (hasOnActivation(def.config) || crossedTrailIds.has(def.id)) {
      continue;
    }

    diagnostics.push(
      buildDeadInternalTrailDiagnostic(
        def.id,
        filePath,
        offsetToLine(sourceCode, def.start)
      )
    );
  }

  return diagnostics;
};

export const deadInternalTrail: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    return checkDeadInternalTrails(
      ast,
      sourceCode,
      filePath,
      ast ? collectCrossTargetTrailIds(ast, sourceCode) : new Set<string>()
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    const localCrossTargetTrailIds = ast
      ? collectCrossTargetTrailIds(ast, sourceCode)
      : new Set<string>();
    return checkDeadInternalTrails(
      ast,
      sourceCode,
      filePath,
      context.crossTargetTrailIds ?? localCrossTargetTrailIds
    );
  },
  description:
    'Warn when an internal trail has no crossings anywhere in the project and no on: activation.',
  name: 'dead-internal-trail',
  severity: 'warn',
};
