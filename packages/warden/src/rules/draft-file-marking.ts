import { isDraftId } from '@ontrails/core';

import { isDraftMarkedFile } from '../draft.js';
import { findStringLiterals, offsetToLine, parse } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const messageForMissingMarker = (draftId: string): string =>
  `Draft id "${draftId}" appears in source, but the file is not draft-marked. ` +
  'Rename it with an _draft. prefix or a .draft. trailing segment.';

const makeDiagnostic = (
  sourceCode: string,
  filePath: string,
  start: number,
  message: string,
  severity: WardenDiagnostic['severity']
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, start),
  message,
  rule: 'draft-file-marking',
  severity,
});

const draftMissingMarkerDiagnostic = (
  sourceCode: string,
  filePath: string,
  ast: NonNullable<ReturnType<typeof parse>>
): WardenDiagnostic | null => {
  const draftMatches = findStringLiterals(ast, (value) => isDraftId(value));
  if (!draftMatches.length || isDraftMarkedFile(filePath)) {
    return null;
  }

  const [first] = draftMatches;
  if (!first) {
    return null;
  }

  return makeDiagnostic(
    sourceCode,
    filePath,
    first.start,
    messageForMissingMarker(first.value),
    'error'
  );
};

const draftMarkedWithoutIdsDiagnostic = (
  filePath: string,
  ast: NonNullable<ReturnType<typeof parse>>
): WardenDiagnostic | null => {
  if (findStringLiterals(ast, (value) => isDraftId(value)).length > 0) {
    return null;
  }

  if (!isDraftMarkedFile(filePath)) {
    return null;
  }

  return {
    filePath,
    line: 1,
    message:
      'File is draft-marked but no longer contains draft ids. Remove the draft filename marker or finish the promotion cleanup.',
    rule: 'draft-file-marking',
    severity: 'warn',
  };
};

const collectDraftFileMarkingDiagnostics = (
  sourceCode: string,
  filePath: string,
  ast: NonNullable<ReturnType<typeof parse>>
): WardenDiagnostic[] => {
  const missingMarkerDiagnostic = draftMissingMarkerDiagnostic(
    sourceCode,
    filePath,
    ast
  );
  if (missingMarkerDiagnostic) {
    return [missingMarkerDiagnostic];
  }

  const markedWithoutIdsDiagnostic = draftMarkedWithoutIdsDiagnostic(
    filePath,
    ast
  );
  if (markedWithoutIdsDiagnostic) {
    return [markedWithoutIdsDiagnostic];
  }

  return [];
};

/**
 * Ensures files containing draft ids are visibly marked as draft-bearing files.
 */
export const draftFileMarking: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return collectDraftFileMarkingDiagnostics(sourceCode, filePath, ast);
  },
  description:
    'Require draft-bearing files to use _draft.* or *.draft.* filename markers.',
  name: 'draft-file-marking',
  severity: 'error',
};
