import type { ActionResultContext } from '@ontrails/cli';
import { deriveOutputMode } from '@ontrails/cli';

interface AdapterCheckResultValue {
  readonly formatted: string;
  readonly passed: boolean;
}

const isAdapterCheckResultValue = (
  value: unknown
): value is AdapterCheckResultValue => {
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

const isAdapterCheckTrail = (ctx: ActionResultContext): boolean =>
  ctx.trail.id === 'adapter.check';

const readAdapterCheckResultValue = (
  ctx: ActionResultContext
): AdapterCheckResultValue | undefined => {
  if (!isAdapterCheckTrail(ctx) || ctx.result.isErr()) {
    return undefined;
  }

  return isAdapterCheckResultValue(ctx.result.value)
    ? ctx.result.value
    : undefined;
};

export const applyAdapterCheckExitCode = (
  ctx: ActionResultContext
): boolean => {
  if (!isAdapterCheckTrail(ctx)) {
    return false;
  }

  if (ctx.result.isErr()) {
    process.exitCode = 1;
    return true;
  }

  const value = readAdapterCheckResultValue(ctx);
  if (!value) {
    return false;
  }

  process.exitCode = value.passed ? 0 : 1;
  return true;
};

export const tryAdapterCheckOutput = (ctx: ActionResultContext): boolean => {
  const value = readAdapterCheckResultValue(ctx);
  if (!value) {
    return false;
  }

  applyAdapterCheckExitCode(ctx);
  if (wantsStructuredOutput(ctx)) {
    return false;
  }

  if (value.formatted.length > 0) {
    process.stdout.write(`${value.formatted}\n`);
  }
  return true;
};
