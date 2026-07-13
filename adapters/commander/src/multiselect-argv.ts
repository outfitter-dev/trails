import { Command } from 'commander';
import type { ParseOptions, Option } from 'commander';
import { normalizeCliArgv } from '@ontrails/cli';
import type { CliCommand } from '@ontrails/cli';

type EffectiveParseOptions = Omit<ParseOptions, 'from'> & {
  readonly from?: ParseOptions['from'] | 'eval' | undefined;
};

export const visibleOptionsFor = (command: Command): readonly Option[] => {
  const commands: Command[] = [];
  let current: Command | null = command;
  while (current !== null) {
    commands.push(current);
    current = current.parent;
  }
  return commands.toReversed().flatMap((owner) => owner.options);
};

export interface InvocationOptionMatch {
  readonly inlineValue: boolean;
  readonly option: Option;
}

const findShortOption = (
  options: readonly Option[],
  short: string
): Option | undefined => options.find((candidate) => candidate.short === short);

export const invocationOptionMatches = (
  options: readonly Option[],
  token: string
): readonly InvocationOptionMatch[] => {
  const exact = options.filter(
    (option) => token === option.long || token === option.short
  );
  if (exact.length > 0) {
    return exact.map((option) => ({ inlineValue: false, option }));
  }

  const longWithValue = options.filter(
    (option) =>
      option.long !== undefined &&
      (option.required || option.optional) &&
      token.startsWith(`${option.long}=`)
  );
  if (longWithValue.length > 0) {
    return longWithValue.map((option) => ({ inlineValue: true, option }));
  }

  if (token.length <= 2 || token[0] !== '-' || token[1] === '-') {
    return [];
  }

  const matches: InvocationOptionMatch[] = [];
  let group = token.slice(1);
  while (group.length > 0) {
    const option = findShortOption(options, `-${group[0]}`);
    if (option === undefined) {
      break;
    }
    const inlineValue =
      (option.required || option.optional) && group.length > 1;
    matches.push({ inlineValue, option });
    if (option.required || option.optional) {
      break;
    }
    group = group.slice(1);
  }
  return matches;
};

export const isNegativeNumberArg = (
  command: Command,
  token: string
): boolean => {
  if (!/^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/.test(token)) {
    return false;
  }

  for (
    let current: Command | null = command;
    current !== null;
    current = current.parent
  ) {
    if (current.options.some((option) => /^-\d$/.test(option.short ?? ''))) {
      return false;
    }
  }

  return true;
};

export const optionConsumesFollowingValue = (
  command: Command,
  match: InvocationOptionMatch,
  nextToken: string | undefined
): boolean =>
  !match.inlineValue &&
  (match.option.required ||
    (match.option.optional &&
      nextToken !== undefined &&
      (!nextToken.startsWith('-') || isNegativeNumberArg(command, nextToken))));

const argvUserStart = (
  parseOptions?: EffectiveParseOptions | undefined
): number => {
  if (parseOptions?.from === 'user') {
    return 0;
  }
  if (parseOptions?.from === 'eval') {
    return 1;
  }
  if (parseOptions?.from === 'electron') {
    const electronProcess = process as NodeJS.Process & {
      readonly defaultApp?: boolean | undefined;
    };
    return electronProcess.defaultApp ? 2 : 1;
  }
  return 2;
};

const effectiveParseOptions = (
  argv: readonly string[] | undefined,
  parseOptions: ParseOptions | undefined
): EffectiveParseOptions | undefined => {
  if (
    argv === undefined &&
    parseOptions?.from === undefined &&
    process.execArgv.some((arg) =>
      ['-e', '--eval', '-p', '--print'].includes(arg)
    )
  ) {
    // Commander supports this origin internally but does not publish it in
    // ParseOptions. Preserve its one-token offset while normalizing argv.
    return { from: 'eval' };
  }
  if (
    argv === undefined &&
    parseOptions?.from === undefined &&
    process.versions['electron'] !== undefined
  ) {
    return { from: 'electron' };
  }
  return parseOptions;
};

export class TrailsCommanderProgram extends Command {
  readonly #commands: readonly CliCommand[];

  constructor(commands: readonly CliCommand[]) {
    super();
    this.#commands = commands;
  }

  #normalizeArgv(
    argv: readonly string[] | undefined,
    parseOptions: EffectiveParseOptions | undefined
  ): readonly string[] {
    const input = argv ?? process.argv;
    const start = argvUserStart(parseOptions);
    return [
      ...input.slice(0, start),
      ...normalizeCliArgv(this.#commands, input.slice(start)),
    ];
  }

  override parse(argv?: readonly string[], parseOptions?: ParseOptions): this {
    const options = effectiveParseOptions(argv, parseOptions);
    const normalized = this.#normalizeArgv(argv, options);
    return super.parse(normalized, options as ParseOptions | undefined);
  }

  override parseAsync(
    argv?: readonly string[],
    parseOptions?: ParseOptions
  ): Promise<this> {
    const options = effectiveParseOptions(argv, parseOptions);
    const normalized = this.#normalizeArgv(argv, options);
    return super.parseAsync(normalized, options as ParseOptions | undefined);
  }
}
