/** Shared source-edit helpers. */

import type { SourceEdit } from './nodes.js';

export const createSourceEdit = (
  start: number,
  end: number,
  replacement: string
): SourceEdit => ({ end, replacement, start });

export const validateSourceEdits = (
  edits: readonly SourceEdit[],
  sourceLength?: number
): readonly SourceEdit[] => {
  const ordered = [...edits].toSorted(
    (left, right) => left.start - right.start
  );
  for (let i = 0; i < ordered.length; i += 1) {
    const edit = ordered[i];
    if (!edit) {
      continue;
    }
    if (
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      (sourceLength !== undefined && edit.end > sourceLength)
    ) {
      throw new Error(`Invalid source edit range ${edit.start}-${edit.end}.`);
    }

    const previous = ordered[i - 1];
    if (previous && edit.start < previous.end) {
      throw new Error(
        `Overlapping source edits ${previous.start}-${previous.end} and ${edit.start}-${edit.end}.`
      );
    }
  }

  return ordered;
};

export const applySourceEdits = (
  sourceCode: string,
  edits: readonly SourceEdit[]
): string => {
  validateSourceEdits(edits, sourceCode.length);

  return [...edits]
    .toSorted((left, right) => right.start - left.start)
    .reduce(
      (output, edit) =>
        output.slice(0, edit.start) + edit.replacement + output.slice(edit.end),
      sourceCode
    );
};
