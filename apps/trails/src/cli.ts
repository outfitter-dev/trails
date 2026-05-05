import { defaultOnResult, outputModePreset } from '@ontrails/cli';
import type { ActionResultContext } from '@ontrails/cli';
import { surface } from '@ontrails/cli/commander';

import { app } from './app.js';
import { resolveInputWithClack } from './clack.js';
import { tryRecoverFromRunCollision } from './run-collision.js';
import { trailsPackageVersion } from './versions.js';

const onResult = async (ctx: ActionResultContext): Promise<void> => {
  const recovered = await tryRecoverFromRunCollision(ctx, { graph: app });
  if (recovered === undefined) {
    await defaultOnResult(ctx);
    return;
  }
  await defaultOnResult({
    ...ctx,
    input: recovered.isOk()
      ? (ctx.trail.input.safeParse(ctx.input).data ?? ctx.input)
      : ctx.input,
    result: recovered,
  });
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
