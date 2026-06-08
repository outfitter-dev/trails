import type { ActionResultContext } from '@ontrails/cli';
import { deriveOutputMode } from '@ontrails/cli';

interface ReleaseCheckResultValue {
  readonly formatted: string;
  readonly passed: boolean;
}

const isReleaseCheckResultValue = (
  value: unknown
): value is ReleaseCheckResultValue => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['formatted'] === 'string' &&
    typeof candidate['passed'] === 'boolean'
  );
};

const wantsStructuredOutput = (ctx: ActionResultContext): boolean =>
  deriveOutputMode(ctx.flags, ctx.topoName).mode !== 'text';

const readReleaseCheckResultValue = (
  ctx: ActionResultContext
): ReleaseCheckResultValue | undefined => {
  if (ctx.trail.id !== 'release.check' || ctx.result.isErr()) {
    return undefined;
  }

  return isReleaseCheckResultValue(ctx.result.value)
    ? ctx.result.value
    : undefined;
};

export const applyReleaseCheckExitCode = (
  ctx: ActionResultContext
): boolean => {
  if (ctx.trail.id !== 'release.check') {
    return false;
  }

  if (ctx.result.isErr()) {
    process.exitCode = 1;
    return true;
  }

  const value = readReleaseCheckResultValue(ctx);
  if (!value) {
    return false;
  }

  process.exitCode = value.passed ? 0 : 1;
  return true;
};

export const tryReleaseCheckOutput = (ctx: ActionResultContext): boolean => {
  const value = readReleaseCheckResultValue(ctx);
  if (!value) {
    return false;
  }

  applyReleaseCheckExitCode(ctx);
  if (wantsStructuredOutput(ctx)) {
    return false;
  }

  if (value.formatted.length > 0) {
    process.stdout.write(`${value.formatted}\n`);
  }
  return true;
};
