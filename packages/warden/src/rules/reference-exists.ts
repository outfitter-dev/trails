import {
  collectEntityDefinitionIds,
  collectEntityReferenceSites,
} from './source/entities.js';
import { offsetToLine, parse } from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import { mergeKnownEntityIds } from './entity-ids.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const buildMissingReferenceDiagnostic = (
  sourceEntity: string,
  field: string,
  targetEntity: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Entity "${sourceEntity}" field "${field}" references entity "${targetEntity}" which is not defined in the project. Define it with entity('${targetEntity}', ...) and include it in the topo, or fix the field reference if this is a typo.`,
  rule: 'reference-exists',
  severity: 'error',
});

const checkEntityReferences = (
  ast: AstNode,
  sourceCode: string,
  filePath: string,
  knownEntityIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath)) {
    return [];
  }

  return collectEntityReferenceSites(ast, knownEntityIds).flatMap(
    (reference) => {
      if (knownEntityIds.has(reference.target)) {
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
 * Checks that every entity `.id()` reference resolves to a known entity.
 */
export const referenceExists: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return checkEntityReferences(
      ast,
      sourceCode,
      filePath,
      collectEntityDefinitionIds(ast)
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

    const localEntityIds = collectEntityDefinitionIds(ast);
    return checkEntityReferences(
      ast,
      sourceCode,
      filePath,
      mergeKnownEntityIds(localEntityIds, context.knownEntityIds)
    );
  },
  description:
    'Ensure every entity field declared via .id() resolves to a known entity.',
  name: 'reference-exists',
  severity: 'error',
};
