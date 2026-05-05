/**
 * `completions __complete` internal trail -- dynamic completion suggestions.
 *
 * The static shell scripts emitted by {@link completionsTrail} delegate to this
 * trail at tab-press time. The trail receives the partial argv that the user
 * has typed (after the binary name) and returns newline-delimited suggestions
 * the shell should offer.
 *
 * Today the trail knows about two `run` positions:
 *
 *  - `trails run <prefix>` — return matching trail IDs.
 *  - `trails run example <trail-id> <prefix>` — return matching example names
 *    defined on the resolved trail.
 *
 * The `run example` branch loads the trail's owning app at tab-press time so the
 * suggestions reflect the live trail definition. Unknown trails and no
 * examples naturally collapse to an empty list; recoverable load failures are
 * suppressed here because completion must never surface errors back to the
 * shell mid-keystroke.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  renderTrailExampleCompletions,
  renderTrailIdCompletions,
} from '../completions.js';
import { resolveTrailRootDir } from './root-dir.js';

const EMPTY_SUGGESTIONS = '';

interface CompleteContext {
  readonly args: readonly string[];
  readonly rootDir: string;
}

type CompletionHandler = (ctx: CompleteContext) => Promise<readonly string[]>;

/**
 * Detect whether the user is completing the example-name positional on a
 * `trails run example` invocation.
 *
 * The shell hands us the partial argv with the **last element** as the token
 * being completed. We recognize the `run example <trail-id> <TAB>` shape when:
 *
 *  - the command family is `run example`, and
 *  - a non-flag positional (the trail ID) sits at `args[2]`.
 *
 * Returns the trail ID + prefix to complete, or `null` if the cursor is not
 * in an example-name value position.
 */
const detectExampleValueCompletion = (
  args: readonly string[]
): { readonly trailId: string; readonly prefix: string } | null => {
  if (args.length < 4) {
    return null;
  }
  const [, subcommand, trailId] = args;
  if (subcommand !== 'example') {
    return null;
  }
  if (trailId === undefined || trailId.startsWith('-')) {
    return null;
  }
  const prefix = args[3] ?? '';
  return { prefix, trailId };
};

/**
 * Handler for the `trails run` subcommand.
 *
 * Two completion positions are recognized:
 *
 *  - `trails run example <trail-id> <prefix>` — return example names defined
 *    on the resolved trail (matching `prefix`, sorted).
 *  - `trails run <prefix>` — return matching trail IDs.
 *
 * Anything else (unknown flag context, a cursor beyond the trail ID, etc.)
 * returns no suggestions so completed positional values are not suggested
 * again.
 */
const completeRunPosition: CompletionHandler = async ({ args, rootDir }) => {
  const exampleContext = detectExampleValueCompletion(args);
  if (exampleContext !== null) {
    const suggestionsResult = await renderTrailExampleCompletions(
      rootDir,
      exampleContext.trailId,
      exampleContext.prefix
    );
    return suggestionsResult.unwrapOr([]);
  }
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
