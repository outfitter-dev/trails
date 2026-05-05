import {
  defaultOnResult,
  outputModePreset,
  permitPreset,
  tracePreset,
} from '@ontrails/cli';
import type { ActionResultContext } from '@ontrails/cli';
import { surface } from '@ontrails/cli/commander';

import { app } from './app.js';
import { resolveInputWithClack } from './clack.js';
import { tryRecoverFromRunCollision } from './run-collision.js';
import { tryExampleRunOutput } from './run-example.js';
import { tryExamplesRunOutput } from './run-examples.js';
import { tryQuietRunOutput } from './run-quiet.js';
import {
  argvHasTraceFlag,
  installTraceSink,
  tryTraceJsonOutput,
  writeTraceTreeToStderr,
} from './run-trace.js';
import type { TraceSession } from './run-trace.js';
import { trailsPackageVersion } from './versions.js';

const buildOnResult =
  (session: TraceSession | undefined) =>
  async (ctx: ActionResultContext): Promise<void> => {
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

    // `--trace --json` (without `--quiet`) emits a single Result-shaped
    // envelope on stdout that includes the captured records under
    // `tracing`. Hand that case off before the regular chain so the
    // existing handlers do not also write to stdout.
    if (session !== undefined && tryTraceJsonOutput(resolvedCtx, session)) {
      return;
    }

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

const session: TraceSession | undefined = argvHasTraceFlag(process.argv)
  ? installTraceSink()
  : undefined;

try {
  // oxlint-disable-next-line require-hook -- CLI entry point
  await surface(app, {
    description: 'Agent-native, contract-first TypeScript framework',
    name: 'trails',
    onResult: buildOnResult(session),
    presets: [outputModePreset(), tracePreset(), permitPreset()],
    resolveInput: resolveInputWithClack,
    version: trailsPackageVersion,
  });
} finally {
  if (session !== undefined) {
    const records = session.finalize();
    writeTraceTreeToStderr(records);
  }
}
