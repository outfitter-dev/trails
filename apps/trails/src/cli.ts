import { defaultOnResult, outputModePreset } from '@ontrails/cli';
import type { ActionResultContext } from '@ontrails/cli';
import { surface } from '@ontrails/cli/commander';

import { app } from './app.js';
import { resolveInputWithClack } from './clack.js';
import { tryRecoverFromRunCollision } from './run-collision.js';
import { tryExampleRunOutput } from './run-example.js';
import { tryExamplesRunOutput } from './run-examples.js';
import { tryQuietRunOutput } from './run-quiet.js';
import { trailsPackageVersion } from './versions.js';

const onResult = async (ctx: ActionResultContext): Promise<void> => {
  const recovered = await tryRecoverFromRunCollision(ctx, { graph: app });
  const resolvedCtx: ActionResultContext =
    recovered === undefined
      ? ctx
      : {
          ...ctx,
          input: recovered.isOk()
            ? (ctx.trail.input.safeParse(ctx.input).data ?? ctx.input)
            : ctx.input,
          result: recovered,
        };

  if (tryExampleRunOutput(resolvedCtx)) {
    return;
  }
  if (tryExamplesRunOutput(resolvedCtx)) {
    return;
  }
  if (await tryQuietRunOutput(resolvedCtx)) {
    return;
  }
  await defaultOnResult(resolvedCtx);
};

// oxlint-disable-next-line require-hook -- CLI entry point
await surface(app, {
  description: 'Agent-native, contract-first TypeScript framework',
  name: 'trails',
  onResult,
  presets: [outputModePreset()],
  resolveInput: resolveInputWithClack,
  version: trailsPackageVersion,
});
