/**
 * `completions __complete` internal trail -- dynamic completion suggestions.
 *
 * The static shell scripts emitted by {@link completionsTrail} delegate to this
 * trail at tab-press time. The trail receives the partial argv that the user
 * has typed (after the binary name) and returns newline-delimited suggestions
 * the shell should offer.
 *
 * For TRL-415 the only completion this trail knows about is trail IDs in the
 * `trails run <prefix>` position. Later branches in the completions phase will
 * extend the dispatch table to cover `--example`, `--app`, and other context.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { renderTrailIdCompletions } from '../completions.js';
import { resolveTrailRootDir } from './root-dir.js';

const EMPTY_SUGGESTIONS = '';

interface CompleteContext {
  readonly args: readonly string[];
  readonly rootDir: string;
}

type CompletionHandler = (ctx: CompleteContext) => Promise<readonly string[]>;

/**
 * Handler for `trails run <prefix>` — return matching trail IDs.
 *
 * The user has typed `trails run` and is completing the next positional
 * argument; `args[1]` is the partial trail ID prefix (possibly empty).
 */
const completeRunPosition: CompletionHandler = async ({ args, rootDir }) => {
  if (args.length !== 2) {
    return [];
  }
  const prefix = args[1] ?? '';
  return await renderTrailIdCompletions(rootDir, prefix);
};

const renderSuggestions = (suggestions: readonly string[]): string =>
  suggestions.join('\n');

/**
 * Subcommand → handler dispatch table.
 *
 * Keep this a pure lookup so adding a new completion target (`run example`,
 * `--app`, etc.) is a new entry rather than a new branch.
 *
 * @remarks As more handlers grow per-token-shape logic (e.g. distinguishing
 * `--app <TAB>` vs `<trail-id> <TAB>` for the same subcommand), expect this
 * table to evolve into a sub-table of (token-pattern → completion-fn) per
 * subcommand or a small parser yielding a discriminated `CompletionContext`
 * union. Today the single `'run'` entry is small enough that explicit
 * branching inside `completeRunPosition` is cleaner.
 */
const SUBCOMMAND_HANDLERS: Readonly<Record<string, CompletionHandler>> = {
  run: completeRunPosition,
};

export const completionsCompleteTrail = trail('completions.__complete', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return Result.err(rootDirResult.error);
    }
    const rootDir = rootDirResult.value;

    const [subcommand] = input.args;
    if (subcommand === undefined) {
      return Result.ok(EMPTY_SUGGESTIONS);
    }

    const handler = SUBCOMMAND_HANDLERS[subcommand];
    if (handler === undefined) {
      return Result.ok(EMPTY_SUGGESTIONS);
    }

    const suggestions = await handler({ args: input.args, rootDir });
    return Result.ok(renderSuggestions(suggestions));
  },
  description:
    'Internal: emit dynamic completion suggestions for the current partial argv. Invoked by the static shell completion script at tab-press time.',
  examples: [
    {
      description: 'Empty argv yields no suggestions',
      input: { args: [] },
      name: 'Empty args',
    },
  ],
  input: z.object({
    args: z
      .array(z.string())
      .readonly()
      .describe(
        'Partial argv after the binary name; the last element is the token being completed'
      ),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: z
    .string()
    .describe(
      'Newline-delimited suggestions the shell should offer for the current token'
    ),
});
