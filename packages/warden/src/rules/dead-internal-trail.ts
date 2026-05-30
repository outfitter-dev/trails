import {
  collectComposeTargetTrailIds,
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

const isNonEmptyActivationValue = (onValue: AstNode): boolean => {
  // Identifier reference (e.g. `on: signalsArray`) — conservatively treat as
  // having activation to avoid false positives. We can't cheaply resolve what
  // the identifier binds to, so assume it's a non-empty activation.
  if (onValue.type === 'Identifier') {
    return true;
  }
  if (onValue.type !== 'ArrayExpression') {
    return false;
  }
  const elements = onValue['elements'] as readonly AstNode[] | undefined;
  return (elements?.length ?? 0) > 0;
};

const hasOnActivation = (config: AstNode): boolean => {
  const onProp = findConfigProperty(config, 'on');
  const onValue = onProp?.value as AstNode | undefined;
  return onValue ? isNonEmptyActivationValue(onValue) : false;
};

const hasExplicitInternalVisibility = (config: AstNode): boolean => {
  const visibilityProp = findConfigProperty(config, 'visibility');
  const visibilityValue = visibilityProp?.value as AstNode | undefined;
  return (
    !!visibilityValue &&
    isStringLiteral(visibilityValue) &&
    getStringValue(visibilityValue) === 'internal'
  );
};

/** Check legacy `meta: { internal: true }` convention (mirrors runtime effectiveVisibility). */
const hasLegacyMetaInternal = (config: AstNode): boolean => {
  const metaProp = findConfigProperty(config, 'meta');
  const metaValue = metaProp?.value as AstNode | undefined;
  if (!metaValue || metaValue.type !== 'ObjectExpression') {
    return false;
  }
  const internalProp = findConfigProperty(metaValue, 'internal');
  const internalValue = internalProp?.value as AstNode | undefined;
  return (
    internalValue?.type === 'BooleanLiteral' &&
    (internalValue as unknown as { value: boolean }).value === true
  );
};

const isInternalTrail = (config: AstNode): boolean =>
  hasExplicitInternalVisibility(config) || hasLegacyMetaInternal(config);

const buildDeadInternalTrailDiagnostic = (
  trailId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" is marked visibility: 'internal' but nothing composes it and it has no on: activation. Internal trails should stay reachable through ctx.compose() or reactive activation.`,
  rule: 'dead-internal-trail',
  severity: 'warn',
});

const checkDeadInternalTrails = (
  ast: AstNode | null,
  sourceCode: string,
  filePath: string,
  composedTrailIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath) || !ast) {
    return [];
  }

  const diagnostics: WardenDiagnostic[] = [];

  for (const def of findTrailDefinitions(ast)) {
    if (def.kind !== 'trail' || !isInternalTrail(def.config)) {
      continue;
    }

    if (hasOnActivation(def.config) || composedTrailIds.has(def.id)) {
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
      ast ? collectComposeTargetTrailIds(ast, sourceCode) : new Set<string>()
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    const localComposeTargetTrailIds = ast
      ? collectComposeTargetTrailIds(ast, sourceCode)
      : new Set<string>();
    // Union project-wide compose evidence with the file-local evidence rather
    // than preferring one over the other. The project context only collects
    // compose edges from registered app topos, so a trail defined in a package
    // that is scanned but not part of any registered topo (e.g. an internal
    // child composed in its own module) would be absent from the context set
    // yet present in the local set. Preferring the context set alone produced a
    // false dead-internal-trail warning for those same-file compositions.
    const composeTargetTrailIds = context.composeTargetTrailIds
      ? new Set<string>([
          ...context.composeTargetTrailIds,
          ...localComposeTargetTrailIds,
        ])
      : localComposeTargetTrailIds;
    return checkDeadInternalTrails(
      ast,
      sourceCode,
      filePath,
      composeTargetTrailIds
    );
  },
  description:
    'Warn when an internal trail has no compositions anywhere in the project and no on: activation.',
  name: 'dead-internal-trail',
  severity: 'warn',
};
