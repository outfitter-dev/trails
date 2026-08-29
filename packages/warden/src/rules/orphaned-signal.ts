import { collectOnTargetSignalIds } from './source/signals.js';
import {
  collectCrudTableIds,
  findStoreTableDefinitions,
} from './source/stores.js';
import { offsetToLine, parse } from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const CHANGE_SIGNAL_OPERATIONS = ['created', 'updated', 'removed'] as const;

const buildOrphanedSignalDiagnostic = (
  tableId: string,
  missingSignalIds: readonly string[],
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Store table "${tableId}" derives change signals with no trail on: consumers: ${missingSignalIds.join(', ')}. Consume them with trail on: declarations — prefer the table's typed signal handles (table.signals.created / .updated / .removed), which carry the store-bound identity; a string id must be fully scoped when the store is bound to a resource — or remove the unused reactive pattern if nothing should react to this table's changes.`,
  rule: 'orphaned-signal',
  severity: 'warn',
});

const getMissingSignalIds = (
  tableId: string,
  onTargetSignalIds: ReadonlySet<string>
): readonly string[] =>
  CHANGE_SIGNAL_OPERATIONS.map((operation) => `${tableId}.${operation}`).filter(
    (signalId) =>
      !onTargetSignalIds.has(signalId) &&
      // Bare-name fallback: string-literal `on:` consumers store the signal
      // without the composite `${storeBinding}:` prefix.
      !onTargetSignalIds.has(signalId.replace(/^[^:]+:/, ''))
  );

/**
 * Strip the `${storeBinding}:` prefix from a composite signal id for display.
 * Keeps diagnostic messages readable while keeping keys composite internally.
 */
const stripStoreBinding = (
  signalId: string,
  storeBinding: string | null
): string => {
  if (!storeBinding) {
    return signalId;
  }
  const prefix = `${storeBinding}:`;
  return signalId.startsWith(prefix) ? signalId.slice(prefix.length) : signalId;
};

const buildDefinitionDiagnostic = (
  definition: ReturnType<typeof findStoreTableDefinitions>[number],
  sourceCode: string,
  filePath: string,
  crudTableIds: ReadonlySet<string>,
  onTargetSignalIds: ReadonlySet<string>
): WardenDiagnostic | null => {
  if (!crudTableIds.has(definition.key)) {
    return null;
  }

  const missingSignalIds = getMissingSignalIds(
    definition.key,
    onTargetSignalIds
  );
  return missingSignalIds.length === 0
    ? null
    : buildOrphanedSignalDiagnostic(
        definition.name,
        missingSignalIds.map((id) =>
          stripStoreBinding(id, definition.storeBinding)
        ),
        filePath,
        offsetToLine(sourceCode, definition.start)
      );
};

const checkOrphanedSignals = (
  ast: AstNode | null,
  sourceCode: string,
  filePath: string,
  crudTableIds: ReadonlySet<string>,
  onTargetSignalIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath) || !ast) {
    return [];
  }

  const diagnostics: WardenDiagnostic[] = [];

  for (const definition of findStoreTableDefinitions(ast)) {
    const diagnostic = buildDefinitionDiagnostic(
      definition,
      sourceCode,
      filePath,
      crudTableIds,
      onTargetSignalIds
    );
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
};

export const orphanedSignal: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    return checkOrphanedSignals(
      ast,
      sourceCode,
      filePath,
      ast ? collectCrudTableIds(ast) : new Set<string>(),
      ast ? collectOnTargetSignalIds(ast, sourceCode) : new Set<string>()
    );
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    const localCrudTableIds = ast
      ? collectCrudTableIds(ast)
      : new Set<string>();
    const localOnTargetSignalIds = ast
      ? collectOnTargetSignalIds(ast, sourceCode)
      : new Set<string>();

    return checkOrphanedSignals(
      ast,
      sourceCode,
      filePath,
      context.crudTableIds ?? localCrudTableIds,
      context.onTargetSignalIds ?? localOnTargetSignalIds
    );
  },
  description:
    'Warn when CRUD-backed store change signals are never consumed by trail on: declarations.',
  name: 'orphaned-signal',
  severity: 'warn',
};
