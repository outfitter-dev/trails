import {
  collectCrudTableIds,
  collectReconcileTableIds,
  findStoreTableDefinitions,
  offsetToLine,
  parse,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const buildMissingReconcileDiagnostic = (
  tableId: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Versioned store table "${tableId}" is used with CRUD factories but has no reconcile trail. Add reconcile(...) to complete the versioned store pattern.`,
  rule: 'missing-reconcile',
  severity: 'warn',
});

const checkMissingReconcile = (
  ast: AstNode | null,
  sourceCode: string,
  filePath: string,
  crudTableIds: ReadonlySet<string>,
  reconcileTableIds: ReadonlySet<string>
): readonly WardenDiagnostic[] => {
  if (isTestFile(filePath) || !ast) {
    return [];
  }

  const diagnostics: WardenDiagnostic[] = [];

  for (const definition of findStoreTableDefinitions(ast)) {
    if (
      !definition.versioned ||
      !crudTableIds.has(definition.key) ||
      reconcileTableIds.has(definition.key)
    ) {
      continue;
    }

    diagnostics.push(
      buildMissingReconcileDiagnostic(
        definition.name,
        filePath,
        offsetToLine(sourceCode, definition.start)
      )
    );
  }

  return diagnostics;
};

export const missingReconcile: ProjectAwareWardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    return checkMissingReconcile(
      ast,
      sourceCode,
      filePath,
      ast ? collectCrudTableIds(ast) : new Set<string>(),
      ast ? collectReconcileTableIds(ast) : new Set<string>()
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
    const localReconcileTableIds = ast
      ? collectReconcileTableIds(ast)
      : new Set<string>();

    return checkMissingReconcile(
      ast,
      sourceCode,
      filePath,
      context.crudTableIds ?? localCrudTableIds,
      context.reconcileTableIds ?? localReconcileTableIds
    );
  },
  description:
    'Warn when a versioned store table participates in CRUD factory generation without a matching reconcile trail.',
  name: 'missing-reconcile',
  severity: 'warn',
};
