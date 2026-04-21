import { isDraftId } from '@ontrails/core';

import { isDraftMarkedFile } from '../draft.js';
import {
  collectFrameworkDraftPrefixConstantOffsets,
  findStringLiterals,
  hasIgnoreCommentOnLine,
  offsetToLine,
  parse,
  splitSourceLines,
} from './ast.js';
import type { StringLiteralMatch } from './ast.js';
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

const collectDraftMatches = (
  sourceCode: string,
  filePath: string,
  ast: NonNullable<ReturnType<typeof parse>>
): StringLiteralMatch[] => {
  const frameworkConstantOffsets = collectFrameworkDraftPrefixConstantOffsets(
    ast,
    filePath
  );
  const lines = splitSourceLines(sourceCode);
  return findStringLiterals(ast, (value) => isDraftId(value)).filter(
    (match) => {
      if (frameworkConstantOffsets.has(match.start)) {
        return false;
      }
      if (
        hasIgnoreCommentOnLine(lines, offsetToLine(sourceCode, match.start))
      ) {
        return false;
      }
      return true;
    }
  );
};

const draftMissingMarkerDiagnostic = (
  sourceCode: string,
  filePath: string,
  ast: NonNullable<ReturnType<typeof parse>>
): WardenDiagnostic | null => {
  const draftMatches = collectDraftMatches(sourceCode, filePath, ast);
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
  // Deciding whether the file's `_draft.` marker is still warranted is a
  // question about *all* draft ids present in source, not just the unsuppressed
  // ones. Pragma-suppressed ids still justify a draft-marked filename — a user
  // intentionally silencing them has not removed the draft content. We
  // therefore filter only the framework-constant declarations (which are not
  // draft ids at all) and bypass the pragma filter that `collectDraftMatches`
  // applies.
  const frameworkConstantOffsets = collectFrameworkDraftPrefixConstantOffsets(
    ast,
    filePath
  );
  const unsuppressedDraftIds = findStringLiterals(ast, (value) =>
    isDraftId(value)
  ).filter((match) => !frameworkConstantOffsets.has(match.start));

  if (unsuppressedDraftIds.length > 0) {
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
