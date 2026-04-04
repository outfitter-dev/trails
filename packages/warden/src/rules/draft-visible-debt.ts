import { isDraftId } from '@ontrails/core';

import { findStringLiterals, offsetToLine, parse } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const createDiagnostic = (
  sourceCode: string,
  filePath: string,
  match: { start: number; value: string }
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, match.start),
  message:
    `Draft id "${match.value}" is still visible debt. ` +
    'Established trailheads, lock export, and OpenAPI generation will reject it until it is promoted.',
  rule: 'draft-visible-debt',
  severity: 'warn',
});

const collectDraftVisibleDebtDiagnostics = (
  sourceCode: string,
  filePath: string,
  ast: NonNullable<ReturnType<typeof parse>>
): WardenDiagnostic[] => {
  const seen = new Set<string>();
  const diagnostics: WardenDiagnostic[] = [];

  for (const match of findStringLiterals(ast, (value) => isDraftId(value))) {
    const key = `${match.value}:${String(match.start)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    diagnostics.push(createDiagnostic(sourceCode, filePath, match));
  }

  return diagnostics;
};

/**
 * Warns when draft ids are still present so the debt stays visible during
 * review even when the file is correctly marked.
 *
 * Severity is intentionally `warn`, not `error`. The hard rejection gate for
 * draft state leaking into established outputs is `validateEstablishedTopo` at
 * runtime — it blocks topo export, trailhead projection, and lockfile writes.
 * This rule surfaces the debt for human reviewers without duplicating that gate.
 */
export const draftVisibleDebt: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return collectDraftVisibleDebtDiagnostics(sourceCode, filePath, ast);
  },
  description:
    'Warn when draft ids remain in source so the debt stays visible during review.',
  name: 'draft-visible-debt',
  severity: 'warn',
};
