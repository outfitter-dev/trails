/**
 * CLI-surface bridge for the `run` trail's collision UX.
 *
 * The `run` trail is surface-agnostic: when a trail id collides across two or
 * more workspace apps and no `--app` override is provided, the trail returns
 * `Result.err(AmbiguousError)` with the candidate app names in `error.context`.
 *
 * The CLI surface decides whether to prompt the user (TTY) or surface the
 * error verbatim (non-TTY). This module owns that surface decision so the
 * trail itself never reads `process.stdin.isTTY` or imports a prompt library.
 */

import type { ActionResultContext } from '@ontrails/cli';
import { AmbiguousError, executeTrail, isPlainObject } from '@ontrails/core';
import type { Result, Topo } from '@ontrails/core';
import * as clack from '@clack/prompts';

/** Runtime dependencies the wrapper resolves through; injectable for tests. */
export interface RunCollisionDeps {
  readonly graph: Topo;
  readonly isTTY?: () => boolean;
  readonly promptForApp?: (
    candidates: readonly string[],
    trailId: string
  ) => Promise<string | undefined>;
}

const defaultIsTTY = (): boolean => process.stdin.isTTY === true;

const defaultPromptForApp = async (
  candidates: readonly string[],
  trailId: string
): Promise<string | undefined> => {
  const choice = await clack.select({
    message: `Trail ID '${trailId}' is exposed by multiple apps. Choose one:`,
    options: candidates.map((appName) => ({
      label: appName,
      value: appName,
    })),
  });
  return clack.isCancel(choice) ? undefined : (choice as string);
};

const isAmbiguousCollision = (
  ctx: ActionResultContext
): ctx is ActionResultContext & {
  readonly result: { readonly error: AmbiguousError };
} =>
  ctx.trail.id === 'run' &&
  ctx.result.isErr() &&
  ctx.result.error instanceof AmbiguousError;

const readCandidates = (error: AmbiguousError): readonly string[] => {
  const ctx = error.context;
  if (!isPlainObject(ctx)) {
    return [];
  }
  const raw = ctx['candidates'];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((entry): entry is string => typeof entry === 'string');
};

const readTrailId = (error: AmbiguousError): string | undefined => {
  const ctx = error.context;
  if (!isPlainObject(ctx)) {
    return;
  }
  const raw = ctx['trailId'];
  return typeof raw === 'string' ? raw : undefined;
};

const hasAppOverride = (input: unknown): boolean =>
  isPlainObject(input) && typeof input['app'] === 'string';

const mergeAppOverride = (
  input: unknown,
  app: string
): Record<string, unknown> => ({
  ...(isPlainObject(input) ? input : {}),
  app,
});

/**
 * Try to recover from an ambiguous-trail-id collision on the run trail.
 *
 * Returns the re-execution result when a TTY prompt yielded a chosen app, or
 * `undefined` when there is nothing to recover (non-TTY, non-collision, or the
 * user cancelled). The caller forwards `undefined` to the default result
 * handler, which surfaces the error verbatim and maps it to exit code 1.
 */
export const tryRecoverFromRunCollision = async (
  ctx: ActionResultContext,
  deps: RunCollisionDeps
): Promise<Result<unknown, Error> | undefined> => {
  if (!isAmbiguousCollision(ctx)) {
    return;
  }
  if (hasAppOverride(ctx.input)) {
    return;
  }

  const isTTY = deps.isTTY ?? defaultIsTTY;
  if (!isTTY()) {
    return;
  }

  const { error } = ctx.result;
  const candidates = readCandidates(error);
  const trailId = readTrailId(error);
  if (candidates.length === 0 || trailId === undefined) {
    return;
  }

  const promptForApp = deps.promptForApp ?? defaultPromptForApp;
  const chosen = await promptForApp(candidates, trailId);
  if (chosen === undefined) {
    return;
  }

  return await executeTrail(ctx.trail, mergeAppOverride(ctx.input, chosen), {
    topo: deps.graph,
  });
};
