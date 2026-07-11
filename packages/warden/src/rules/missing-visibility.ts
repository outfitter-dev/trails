import { collectComposeTargetTrailIds } from './source/composition.js';
import { parse } from '../source/parse.js';
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
  return /(?:^|[{,])\s*internal\s*:\s*true/.test(meta);
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

const hasRequiredComposeInput = (spec: TrailLikeSpec): boolean => {
  const composeInput = spec.properties.get('composeInput');
  if (!composeInput) {
    return false;
  }

  const fields = parseZodObjectShape(composeInput.value);
  return [...fields.values()].some((field) => field.required);
};

const buildMissingVisibilityDiagnostic = (
  trailId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" is composed elsewhere and declares required composeInput fields, but it is still public. Consider visibility: 'internal' so surfaces do not expose a trail that only works through ctx.compose().`,
  rule: 'missing-visibility',
  severity: 'warn',
});

const checkMissingVisibility = (
  sourceCode: string,
  filePath: string,
  composedTrailIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const diagnostics: WardenDiagnostic[] = [];

  for (const spec of findTrailLikeSpecs(sourceCode)) {
    if (
      spec.kind !== 'trail' ||
      trailVisibility(spec) === 'internal' ||
      !composedTrailIds.has(spec.id) ||
      !hasRequiredComposeInput(spec)
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
    return checkMissingVisibility(
      sourceCode,
      filePath,
      context.composeTargetTrailIds ?? localComposeTargetTrailIds
    );
  },
  description:
    'Coach when a composed trail still looks composition-only because it declares required composeInput but remains public.',
  name: 'missing-visibility',
  severity: 'warn',
};
