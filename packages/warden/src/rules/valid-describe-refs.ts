import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';
import { isTestFile } from './scan.js';
import { collectTrailIds, parseStringLiteral } from './specs.js';
import { captureBalanced, lineNumberAt } from './structure.js';

const DESCRIBE_PATTERN = /\.describe\s*\(/g;

const SEE_PATTERN = /@see\s+([A-Za-z0-9_.-]+)/g;

interface DescribeRef {
  readonly line: number;
  readonly ref: string;
}

const describeTextAt = (
  sourceCode: string,
  matchIndex: number
): string | null => {
  const openParen = sourceCode.indexOf('(', matchIndex);
  if (openParen === -1) {
    return null;
  }

  return captureBalanced(sourceCode, openParen)?.text.slice(1, -1) ?? null;
};

const refsInDescription = (
  description: string,
  line: number
): readonly DescribeRef[] =>
  [...description.matchAll(SEE_PATTERN)].flatMap((see) =>
    see[1] ? [{ line, ref: see[1] }] : []
  );

const refsForDescribe = (
  sourceCode: string,
  matchIndex: number
): readonly DescribeRef[] => {
  const args = describeTextAt(sourceCode, matchIndex);
  const description = args ? parseStringLiteral(args) : null;
  return description === null
    ? []
    : refsInDescription(description, lineNumberAt(sourceCode, matchIndex));
};

const collectDescribeRefs = (sourceCode: string): readonly DescribeRef[] =>
  [...sourceCode.matchAll(DESCRIBE_PATTERN)].flatMap((match) =>
    match.index === undefined ? [] : refsForDescribe(sourceCode, match.index)
  );

const checkDescribeRefs = (
  sourceCode: string,
  filePath: string,
  knownTrailIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  return collectDescribeRefs(sourceCode)
    .filter(({ ref }) => !knownTrailIds.has(ref))
    .map(({ line, ref }) => ({
      filePath,
      line,
      message: `@see reference "${ref}" does not resolve to a defined trail.`,
      rule: 'valid-describe-refs',
      severity: 'warn' as const,
    }));
};

/**
 * Warns when @see references inside Zod .describe() strings point at unknown
 * trails.
 */
export const validDescribeRefs: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkDescribeRefs(sourceCode, filePath, collectTrailIds(sourceCode));
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    return checkDescribeRefs(sourceCode, filePath, context.knownTrailIds);
  },
  description:
    'Ensure @see tags inside schema .describe() strings reference defined trails.',
  name: 'valid-describe-refs',
  severity: 'warn',
};
