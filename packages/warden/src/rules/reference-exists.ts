import {
  collectContourDefinitionIds,
  collectContourReferenceSites,
  offsetToLine,
  parse,
} from './ast.js';
import type { AstNode } from './ast.js';
import { mergeKnownContourIds } from './contour-ids.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const buildMissingReferenceDiagnostic = (
  sourceContour: string,
  field: string,
  targetContour: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Contour "${sourceContour}" field "${field}" references contour "${targetContour}" which is not defined in the project.`,
  rule: 'reference-exists',
  severity: 'error',
});

const checkContourReferences = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownContourIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  return collectContourReferenceSites(ast, knownContourIds).flatMap(
    (reference) => {
      if (knownContourIds.has(reference.target)) {
        return [];
      }

      return [
        buildMissingReferenceDiagnostic(
          reference.source,
          reference.field,
          reference.target,
          filePath,
          offsetToLine(sourceCode, reference.start)
        ),
      ];
    }
  );
};

/**
 * Checks that every contour `.id()` reference resolves to a known contour.
 */
export const referenceExists: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return checkContourReferences(
      ast,
      sourceCode,
      filePath,
      collectContourDefinitionIds(ast)
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const localContourIds = collectContourDefinitionIds(ast);
    return checkContourReferences(
      ast,
      sourceCode,
      filePath,
      mergeKnownContourIds(localContourIds, context.knownContourIds)
    );
  },
  description:
    'Ensure every contour field declared via .id() resolves to a known contour.',
  name: 'reference-exists',
  severity: 'error',
};
