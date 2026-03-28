import type { EventDefinition } from './ast.js';
import {
  extractConfigArrayIds,
  findEventDefinitions,
  findTrailDefinitions,
  offsetToLine,
  parse,
} from './ast.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const checkEventFromIds = (
  ev: EventDefinition,
  sourceCode: string,
  filePath: string,
  knownIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const originIds = extractConfigArrayIds(ev.config, 'from');
  const lineNum = offsetToLine(sourceCode, ev.start);
  return originIds
    .filter((id) => !knownIds.has(id))
    .map((originId) => ({
      filePath,
      line: lineNum,
      message: `Event "${ev.id}" references origin "${originId}" which is not defined.`,
      rule: 'event-origins-exist',
      severity: 'error' as const,
    }));
};

const checkEventOrigins = (
  sourceCode: string,
  filePath: string,
  knownIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }
  return findEventDefinitions(ast).flatMap((ev) =>
    checkEventFromIds(ev, sourceCode, filePath, knownIds)
  );
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
 * Checks that all trail IDs referenced in event `from` arrays exist.
 */
export const eventOriginsExist: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    return checkEventOrigins(
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
    return checkEventOrigins(sourceCode, filePath, context.knownTrailIds);
  },
  description:
    'Ensure all trail IDs in event from declarations reference defined trails.',
  name: 'event-origins-exist',
  severity: 'error',
};
