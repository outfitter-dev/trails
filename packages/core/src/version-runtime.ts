import { InternalError, ValidationError } from './errors.js';
import { Result } from './result.js';
import type { ExecuteTrailOptions } from './execute.js';
import { getTrailVersionEntryKind } from './trail.js';
import type { AnyTrail, TrailVersionEntry } from './trail.js';
import { validateInput, validateOutput } from './validation.js';

export type TrailVersionCurrentExecutor<
  Options extends ExecuteTrailOptions = ExecuteTrailOptions,
> = (
  trail: AnyTrail,
  input: unknown,
  options?: Options
) => Promise<Result<unknown, Error>>;

const normalizeTransposeError = (
  trail: AnyTrail,
  version: number,
  phase: 'input' | 'output',
  error: unknown
): InternalError => {
  const message = error instanceof Error ? error.message : String(error);
  const options: { cause?: Error; context: Record<string, unknown> } = {
    context: { phase, trailId: trail.id, version },
  };
  if (error instanceof Error) {
    options.cause = error;
  }
  return new InternalError(
    `Trail "${trail.id}" version ${version} transpose.${phase} failed: ${message}`,
    options
  );
};

const runTransposeInput = async (
  trail: AnyTrail,
  version: number,
  entry: TrailVersionEntry,
  input: unknown
): Promise<Result<unknown, Error>> => {
  if (entry.transpose === undefined) {
    return Result.ok(input);
  }

  try {
    return Result.ok(await entry.transpose.input({ input }));
  } catch (error: unknown) {
    return Result.err(normalizeTransposeError(trail, version, 'input', error));
  }
};

const runTransposeOutput = async (
  trail: AnyTrail,
  version: number,
  entry: TrailVersionEntry,
  output: unknown
): Promise<Result<unknown, Error>> => {
  if (entry.transpose === undefined) {
    return Result.ok(output);
  }

  try {
    return Result.ok(await entry.transpose.output({ output }));
  } catch (error: unknown) {
    return Result.err(normalizeTransposeError(trail, version, 'output', error));
  }
};

export const executeTrailRevision = async <
  Options extends ExecuteTrailOptions = ExecuteTrailOptions,
>(
  trail: AnyTrail,
  version: number,
  entry: TrailVersionEntry,
  rawInput: unknown,
  options: Options | undefined,
  executeCurrentTrail: TrailVersionCurrentExecutor<Options>
): Promise<Result<unknown, Error>> => {
  if (getTrailVersionEntryKind(entry) !== 'revision') {
    return Result.err(
      new ValidationError(
        `Trail "${trail.id}" version ${version} is not a revision entry`
      )
    );
  }

  const historicalInput = validateInput(entry.input, rawInput);
  if (historicalInput.isErr()) {
    return historicalInput;
  }

  const currentInput = await runTransposeInput(
    trail,
    version,
    entry,
    historicalInput.value
  );
  if (currentInput.isErr()) {
    return currentInput;
  }

  const currentOutput = await executeCurrentTrail(
    trail,
    currentInput.value,
    options
  );
  if (currentOutput.isErr()) {
    return currentOutput;
  }

  const historicalOutput = await runTransposeOutput(
    trail,
    version,
    entry,
    currentOutput.value
  );
  return historicalOutput.isErr()
    ? historicalOutput
    : validateOutput(entry.output, historicalOutput.value);
};
