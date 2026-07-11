/** Warden-private pragma helpers. */

const WARDEN_IGNORE_NEXT_LINE_PRAGMAS = new Set([
  '// warden-ignore-next-line',
  '<!-- warden-ignore-next-line -->',
]);

/**
 * Split source code into lines for pragma lookups. Callers should split once
 * per `check` invocation and thread the result through to
 * {@link hasIgnoreCommentOnLine} so we avoid re-splitting the full source on
 * every match in files with many draft-like string literals.
 */
export const splitSourceLines = (sourceCode: string): readonly string[] =>
  sourceCode.split('\n');

/**
 * Check whether the line immediately preceding `line` contains a
 * `warden-ignore-next-line` pragma (leading/trailing whitespace tolerated).
 * Pragma scope is strictly one line — an intervening blank line breaks it.
 *
 * Takes a pre-split `lines` array so callers can split the source once per
 * invocation instead of re-splitting for every literal they check.
 *
 * @example
 * ```ts
 * // warden-ignore-next-line
 * const x = '_draft.intentional'; // suppressed
 * ```
 */
export const hasIgnoreCommentOnLine = (
  lines: readonly string[],
  line: number
): boolean => {
  if (line <= 1) {
    return false;
  }

  const previous = lines[line - 2];
  if (previous === undefined) {
    return false;
  }

  return WARDEN_IGNORE_NEXT_LINE_PRAGMAS.has(previous.trim());
};
