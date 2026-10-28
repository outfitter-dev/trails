import { applyCliFlagValueAliases, normalizeCliArgv } from '@ontrails/cli';
import type { CliCommand, CliFlag } from '@ontrails/cli';
import { ValidationError } from '@ontrails/core';

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

/** Match Commander's declared numeric and choice validation. */
const parseFlagValue = (flag: CliFlag, value: string): string | number => {
  const parsed =
    flag.type === 'number' || flag.type === 'number[]' ? Number(value) : value;
  if (typeof parsed === 'number' && !Number.isFinite(parsed)) {
    throw new ValidationError(`"${value}" is not a valid number`);
  }
  if (flag.choices !== undefined && !flag.choices.includes(String(parsed))) {
    throw new ValidationError(
      `Allowed choices are ${flag.choices.join(', ')}.`
    );
  }
  return parsed;
};

const followingFlagValue = (
  flag: CliFlag,
  next: string | undefined
): string | undefined => {
  if (next === undefined) {
    return undefined;
  }
  if (
    flag.required ||
    !next.startsWith('-') ||
    ((flag.type === 'number' || flag.type === 'number[]') &&
      Number.isFinite(Number(next)))
  ) {
    return next;
  }
  return undefined;
};

/** Expand registered short clusters and attached values as Commander does. */
const expandShortToken = (command: CliCommand, token: string): string[] => {
  if (!token.startsWith('-') || token.startsWith('--') || token.length < 3) {
    return [token];
  }
  const expanded: string[] = [];
  let group = token.slice(1);
  while (group.length > 0) {
    const [short] = group;
    const flag = command.flags.find((candidate) => candidate.short === short);
    if (flag === undefined) {
      expanded.push(`-${group}`);
      break;
    }
    group = group.slice(1);
    if (flag.type !== 'boolean') {
      expanded.push(
        group.length > 0 ? `--${flag.name}=${group}` : `--${flag.name}`
      );
      break;
    }
    expanded.push(`--${flag.name}`);
  }
  return expanded;
};

const findFlag = (
  command: CliCommand,
  option: string | undefined
): CliFlag | undefined =>
  command.flags.find(
    (candidate) =>
      option === `--${candidate.name}` ||
      (candidate.short !== undefined && option === `-${candidate.short}`) ||
      (candidate.type === 'boolean' && option === `--no-${candidate.name}`) ||
      candidate.valueAliases?.some((alias) => option === `--${alias.name}`)
  );

const consumeFlagValues = (
  flag: CliFlag,
  value: string,
  tokens: readonly string[],
  start: number
): { values: (string | number)[]; index: number } => {
  const values = [parseFlagValue(flag, value)];
  let index = start;
  if (flag.variadic) {
    const optional = { ...flag, required: false };
    let next = followingFlagValue(optional, tokens[index + 1]);
    while (next !== undefined) {
      values.push(parseFlagValue(flag, next));
      index += 1;
      next = followingFlagValue(optional, tokens[index + 1]);
    }
  }
  return { index, values };
};

/**
 * Parse only flags registered on the derived command, including preset flags.
 * Registration mirrors adapters/commander/src/to-commander.ts:buildOptions;
 * keep the harness independent of that optional framework adapter.
 */
export const parseCliHarnessFlags = (
  command: CliCommand,
  argv: string[]
): Record<string, unknown> => {
  const tokens = normalizeCliArgv([command], [...command.path, ...argv]).slice(
    command.path.length
  );
  const flags: Record<string, unknown> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const original = tokens[i];
    if (original === '--') {
      break;
    }
    if (original !== undefined) {
      tokens.splice(i, 1, ...expandShortToken(command, original));
    }
    const token = tokens[i];
    if (token === undefined || !token.startsWith('-')) {
      continue;
    }
    const [option, ...inline] = token.split('=');
    const flag = findFlag(command, option);
    if (flag === undefined) {
      throw new ValidationError(`Unknown option '${option}'`);
    }
    const alias = flag.valueAliases?.find(
      (value) => option === `--${value.name}`
    );
    const key = (alias?.name ?? flag.name).replaceAll(
      /-([a-zA-Z0-9])/g,
      (_, char: string) => char.toUpperCase()
    );
    if (flag.type === 'boolean' || alias !== undefined) {
      if (inline.length > 0) {
        throw new ValidationError(`Option '${option}' does not take a value`);
      }
      flags[key] = option !== `--no-${flag.name}`;
      continue;
    }
    const value =
      inline.length > 0
        ? inline.join('=')
        : followingFlagValue(flag, tokens[i + 1]);
    if (value === undefined) {
      if (flag.required) {
        throw new ValidationError(`Option '${option}' argument missing`);
      }
      flags[key] = true;
      continue;
    }
    if (inline.length === 0) {
      i += 1;
    }
    const { values, index } = consumeFlagValues(flag, value, tokens, i);
    i = index;
    flags[key] = flag.type.endsWith('[]')
      ? [...(Array.isArray(flags[key]) ? flags[key] : []), ...values]
      : values[0];
  }
  return applyCliFlagValueAliases(command.flags, flags);
};
