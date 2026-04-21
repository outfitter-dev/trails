import {
  extractStringOrTemplateLiteral,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import { collectTrailIds } from './specs.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const SEE_PATTERN = /@see\s+([A-Za-z0-9_.-]+)/g;

interface DescribeRef {
  readonly line: number;
  readonly ref: string;
}

const STRING_LITERAL_ARG_TYPES: ReadonlySet<string> = new Set([
  'Literal',
  'StringLiteral',
  'TemplateLiteral',
]);

const MEMBER_CALLEE_TYPES: ReadonlySet<string> = new Set([
  'MemberExpression',
  'StaticMemberExpression',
]);

const isDescribeMemberCallee = (callee: AstNode | undefined): boolean => {
  if (!callee || !MEMBER_CALLEE_TYPES.has(callee.type)) {
    return false;
  }
  const prop = (callee as unknown as { property?: AstNode }).property;
  return (
    prop?.type === 'Identifier' &&
    (prop as unknown as { name?: string }).name === 'describe'
  );
};

const hasStringLiteralFirstArg = (node: AstNode): boolean => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  const firstArg = args?.[0];
  return !!firstArg && STRING_LITERAL_ARG_TYPES.has(firstArg.type);
};

const isDescribeCall = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  if (!isDescribeMemberCallee(node['callee'] as AstNode | undefined)) {
    return false;
  }
  // Narrow to calls whose first argument is a string/template literal.
  // Filters out RxJS-style `.describe(fn)` and other custom APIs whose
  // `.describe()` overloads take non-string arguments. Zod's shape always
  // passes a string literal here.
  return hasStringLiteralFirstArg(node);
};

/**
 * Extract scannable text from a template literal, even when it contains
 * `${...}` expressions. Concatenates the cooked quasi chunks with an empty
 * string between them — interpolated values are runtime-only and cannot
 * contribute static `@see` tokens, but the surrounding quasi text can.
 *
 * This is intentionally describe-local: the shared
 * {@link extractStringOrTemplateLiteral} helper preserves "plain template
 * literal only" semantics for other rules (e.g. resolving trail/signal IDs)
 * that require a single clean string value. Here we only need to scan for
 * `@see` tokens, so concatenating quasi cooked text is sound.
 *
 * @remarks
 * A quasi's `cooked` value can be `null` in tagged-template positions where
 * the literal contains escape sequences the parser can't decode. `.describe`
 * is a plain method call, not a tagged template, so in practice its quasis
 * always have a `cooked` string today. The `raw` fallback is defensive: if a
 * future refactor wraps `describe(\`...\`)` in a tagged template, we still
 * scan the raw source rather than silently dropping the quasi text and
 * missing an `@see` token.
 */
const extractQuasiText = (quasi: AstNode): string | null => {
  const { value } = quasi as unknown as {
    value?: { cooked?: unknown; raw?: unknown };
  };
  if (typeof value?.cooked === 'string') {
    return value.cooked;
  }
  if (typeof value?.raw === 'string') {
    return value.raw;
  }
  return null;
};

const extractTemplateLiteralQuasiText = (node: AstNode): string | null => {
  if (node.type !== 'TemplateLiteral') {
    return null;
  }
  const quasis = (node['quasis'] as readonly AstNode[] | undefined) ?? [];
  const parts: string[] = [];
  for (const quasi of quasis) {
    const text = extractQuasiText(quasi);
    if (text !== null) {
      parts.push(text);
    }
  }
  return parts.join('');
};

const extractDescribeDescription = (node: AstNode): string | null => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  const [firstArg] = args ?? [];
  if (!firstArg) {
    return null;
  }
  return (
    extractStringOrTemplateLiteral(firstArg) ??
    extractTemplateLiteralQuasiText(firstArg)
  );
};

/**
 * Anchor the diagnostic on the string argument that actually contains the
 * `@see` token, not on the call-expression start. For multi-line schema
 * chains, the call-expression start can be many lines above the describe
 * argument, which confuses editor tooling.
 */
const describeAnchorOffset = (node: AstNode): number => {
  const args = node['arguments'] as readonly AstNode[] | undefined;
  return args?.[0]?.start ?? node.start;
};

const collectRefsFromDescription = (
  description: string,
  line: number,
  out: DescribeRef[]
): void => {
  for (const match of description.matchAll(SEE_PATTERN)) {
    const [, ref] = match;
    if (ref) {
      out.push({ line, ref });
    }
  }
};

const collectDescribeRefs = (
  ast: AstNode,
  sourceCode: string
): readonly DescribeRef[] => {
  const refs: DescribeRef[] = [];

  walk(ast, (node) => {
    if (!isDescribeCall(node)) {
      return;
    }
    const description = extractDescribeDescription(node);
    if (description === null) {
      return;
    }
    const line = offsetToLine(sourceCode, describeAnchorOffset(node));
    collectRefsFromDescription(description, line, refs);
  });

  return refs;
};

const checkDescribeRefs = (
  sourceCode: string,
  filePath: string,
  knownTrailIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  return collectDescribeRefs(ast, sourceCode)
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
