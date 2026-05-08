import type { ActionResultContext } from '@ontrails/cli';

interface WardenResultValue {
  readonly formatted: string;
  readonly passed: boolean;
}

const isWardenResultValue = (value: unknown): value is WardenResultValue => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['formatted'] === 'string' &&
    typeof candidate['passed'] === 'boolean'
  );
};

export const tryWardenOutput = (ctx: ActionResultContext): boolean => {
  if (ctx.trail.id !== 'warden' || ctx.result.isErr()) {
    return false;
  }
  const { value } = ctx.result;
  if (!isWardenResultValue(value)) {
    return false;
  }

  if (value.formatted.length > 0) {
    process.stdout.write(`${value.formatted}\n`);
  }
  process.exitCode = value.passed ? 0 : 1;
  return true;
};
