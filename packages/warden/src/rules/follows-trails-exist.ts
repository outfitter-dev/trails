import type { TrailDefinition } from './ast.js';
import {
  extractConfigArrayIds,
  findTrailDefinitions,
  offsetToLine,
  parse,
} from './ast.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const checkHikeFollows = (
  def: TrailDefinition,
  sourceCode: string,
  filePath: string,
  knownIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const followedIds = extractConfigArrayIds(def.config, 'follows');
  const lineNum = offsetToLine(sourceCode, def.start);
  return followedIds
    .filter((id) => !knownIds.has(id))
    .map((followedId) => ({
      filePath,
      line: lineNum,
      message: `Route "${def.id}" follows "${followedId}" which is not defined.`,
      rule: 'follows-trails-exist',
      severity: 'error' as const,
    }));
};

const checkFollowsExist = (
  sourceCode: string,
  filePath: string,
  knownIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }
  return findTrailDefinitions(ast)
    .filter((def) => def.kind === 'hike')
    .flatMap((def) => checkHikeFollows(def, sourceCode, filePath, knownIds));
};

const collectLocalTrailIds = (
  sourceCode: string,
  filePath: string
): ReadonlySet<string> => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return new Set();
  }
  return new Set(findTrailDefinitions(ast).map((d) => d.id));
};

/**
 * Checks that all trail IDs referenced in `follows` arrays exist.
 */
export const followsTrailsExist: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkFollowsExist(
      sourceCode,
      filePath,
      collectLocalTrailIds(sourceCode, filePath)
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    return checkFollowsExist(sourceCode, filePath, context.knownTrailIds);
  },
  description:
    'Ensure all trail IDs in follows declarations reference defined trails.',
  name: 'follows-trails-exist',
  severity: 'error',
};
