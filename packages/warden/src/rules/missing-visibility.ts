import { collectCrossTargetTrailIds, parse } from './ast.js';
import { isTestFile } from './scan.js';
import {
  findTrailLikeSpecs,
  parseStringLiteral,
  parseZodObjectShape,
} from './specs.js';
import type { TrailLikeSpec } from './specs.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

/** Check legacy `meta: { internal: true }` convention (mirrors runtime effectiveVisibility). */
const hasLegacyMetaInternal = (spec: TrailLikeSpec): boolean => {
  const meta = spec.properties.get('meta')?.value ?? '';
  return /internal\s*:\s*true/.test(meta);
};

const trailVisibility = (spec: TrailLikeSpec): 'internal' | 'public' => {
  if (
    parseStringLiteral(spec.properties.get('visibility')?.value ?? '') ===
    'internal'
  ) {
    return 'internal';
  }
  return hasLegacyMetaInternal(spec) ? 'internal' : 'public';
};

const hasRequiredCrossInput = (spec: TrailLikeSpec): boolean => {
  const crossInput = spec.properties.get('crossInput');
  if (!crossInput) {
    return false;
  }

  const fields = parseZodObjectShape(crossInput.value);
  return [...fields.values()].some((field) => field.required);
};

const buildMissingVisibilityDiagnostic = (
  trailId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" is crossed elsewhere and declares required crossInput fields, but it is still public. Consider visibility: 'internal' so trailheads do not expose a trail that only works through ctx.cross().`,
  rule: 'missing-visibility',
  severity: 'warn',
});

const checkMissingVisibility = (
  sourceCode: string,
  filePath: string,
  crossedTrailIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const diagnostics: WardenDiagnostic[] = [];

  for (const spec of findTrailLikeSpecs(sourceCode)) {
    if (
      spec.kind !== 'trail' ||
      trailVisibility(spec) === 'internal' ||
      !crossedTrailIds.has(spec.id) ||
      !hasRequiredCrossInput(spec)
    ) {
      continue;
    }

    diagnostics.push(
      buildMissingVisibilityDiagnostic(spec.id, filePath, spec.line)
    );
  }

  return diagnostics;
};

export const missingVisibility: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    return checkMissingVisibility(
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
    return checkMissingVisibility(
      sourceCode,
      filePath,
      context.crossTargetTrailIds ?? localCrossTargetTrailIds
    );
  },
  description:
    'Coach when a crossed trail still looks composition-only because it declares required crossInput but remains public.',
  name: 'missing-visibility',
  severity: 'warn',
};
