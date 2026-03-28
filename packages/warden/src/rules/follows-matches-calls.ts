import type { AstNode, TrailDefinition } from './ast.js';
import {
  extractConfigArrayIds,
  findFollowCallIds,
  findTrailDefinitions,
  offsetToLine,
  parse,
} from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const undeclaredErrors = (
  routeId: string,
  filePath: string,
  lineNum: number,
  declaredSet: ReadonlySet<string>,
  calledSet: ReadonlySet<string>
): readonly WardenDiagnostic[] =>
  [...calledSet]
    .filter((id) => !declaredSet.has(id))
    .map((calledId) => ({
      filePath,
      line: lineNum,
      message: `Route "${routeId}" calls ctx.follow("${calledId}") but "${calledId}" is not in the follows declaration.`,
      rule: 'follows-matches-calls',
      severity: 'error' as const,
    }));

const unusedWarnings = (
  routeId: string,
  filePath: string,
  lineNum: number,
  declaredSet: ReadonlySet<string>,
  calledSet: ReadonlySet<string>
): readonly WardenDiagnostic[] =>
  [...declaredSet]
    .filter((id) => !calledSet.has(id))
    .map((declaredId) => ({
      filePath,
      line: lineNum,
      message: `Route "${routeId}" declares follows "${declaredId}" but never calls ctx.follow("${declaredId}").`,
      rule: 'follows-matches-calls',
      severity: 'warn' as const,
    }));

const checkHikeMismatch = (
  def: TrailDefinition,
  sourceCode: string,
  filePath: string,
  fullAst: AstNode
): readonly WardenDiagnostic[] => {
  const declared = extractConfigArrayIds(def.config, 'follows');
  const called = findFollowCallIds(def.config, fullAst);
  if (declared.length === 0 && called.length === 0) {
    return [];
  }
  const lineNum = offsetToLine(sourceCode, def.start);
  const declaredSet = new Set(declared);
  const calledSet = new Set(called);
  return [
    ...undeclaredErrors(def.id, filePath, lineNum, declaredSet, calledSet),
    ...unusedWarnings(def.id, filePath, lineNum, declaredSet, calledSet),
  ];
};

/**
 * Checks that a route's `follows` declaration matches its `ctx.follow()` calls.
 */
export const followsMatchesCalls: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }
    return findTrailDefinitions(ast)
      .filter((def) => def.kind === 'hike')
      .flatMap((def) => checkHikeMismatch(def, sourceCode, filePath, ast));
  },
  description:
    'Ensure route follows declarations match ctx.follow() calls in implementation.',
  name: 'follows-matches-calls',
  severity: 'error',
};
