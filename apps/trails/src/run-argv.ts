/** Shared pre-surface parsers for operator selection and `trails run`. */

const SELECTION_FLAGS: ReadonlySet<string> = new Set([
  '--app',
  '--module',
  '--root-dir',
]);

const RUN_FLAGS_WITH_VALUES: ReadonlySet<string> = new Set([
  '--app',
  '--input',
  '--input-json',
  '--module',
  '--output',
  '--root-dir',
  '--token',
  '--permit',
]);

const RUN_SHORT_FLAGS_WITH_VALUES: ReadonlySet<string> = new Set(['-o']);

export interface ArgvSelectionControls {
  readonly app?: string | undefined;
  readonly module?: string | undefined;
  readonly rootDir?: string | undefined;
}

export interface ParsedRunArgv {
  readonly positionals: readonly string[];
  readonly selection: ArgvSelectionControls;
}

const assignSelection = (
  selection: { app?: string; module?: string; rootDir?: string },
  flag: string,
  value: string
): void => {
  if (flag === '--app') {
    selection.app = value;
  } else if (flag === '--module') {
    selection.module = value;
  } else if (flag === '--root-dir') {
    selection.rootDir = value;
  }
};

/**
 * Read typed operator selection controls from any partial command argv.
 *
 * Separated and inline values are equivalent. Repeated controls use the last
 * completed value, matching the command surface's normal parsing contract.
 */
export const parseSelectionControls = (
  args: readonly string[]
): ArgvSelectionControls => {
  const selection: {
    app?: string;
    module?: string;
    rootDir?: string;
  } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined || !arg.startsWith('--')) {
      continue;
    }
    const separator = arg.indexOf('=');
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    if (!SELECTION_FLAGS.has(flag)) {
      continue;
    }
    if (separator === -1) {
      const value = args[index + 1];
      if (value !== undefined) {
        assignSelection(selection, flag, value);
        index += 1;
      }
    } else {
      assignSelection(selection, flag, arg.slice(separator + 1));
    }
  }
  return selection;
};

/**
 * Normalize a partial or complete argv slice containing `run`.
 *
 * Known value flags are removed from the positional stream. Config-owned
 * selection controls are retained so pre-surface consumers resolve the same
 * app as the eventual run command. Both separated and inline long values are
 * accepted, and the last completed value wins.
 */
export const parseRunArgv = (args: readonly string[]): ParsedRunArgv => {
  const runIndex = args.indexOf('run');
  const positionals: string[] = [];
  if (runIndex === -1) {
    return { positionals, selection: {} };
  }

  const runArgs = args.slice(runIndex + 1);
  const selection = parseSelectionControls(runArgs);

  for (let index = 0; index < runArgs.length; index += 1) {
    const arg = runArgs[index];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith('--')) {
      const separator = arg.indexOf('=');
      const flag = separator === -1 ? arg : arg.slice(0, separator);
      if (RUN_FLAGS_WITH_VALUES.has(flag) && separator === -1) {
        const value = runArgs[index + 1];
        if (value !== undefined) {
          index += 1;
        }
      }
      continue;
    }
    if (arg.startsWith('-')) {
      if (RUN_SHORT_FLAGS_WITH_VALUES.has(arg)) {
        index += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, selection };
};

/** Read the trail targeted by a normalized run invocation. */
export const readRunTrailId = (args: readonly string[]): string | undefined => {
  const [first, second] = parseRunArgv(args).positionals;
  return first === 'examples' || first === 'example' ? second : first;
};
