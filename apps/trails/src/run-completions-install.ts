/**
 * CLI bridge for installing shell completion scripts.
 *
 * This is intentionally not a trail: it resolves CLI-local defaults such as
 * `$SHELL` and the user's home directory, then writes to the user's completion
 * directory. The surface-agnostic trail remains `completions`, which renders a
 * script string for any caller.
 */

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  renderPublicSurfaceError,
  Result,
  ValidationError,
} from '@ontrails/core';
import type { Command } from 'commander';

import { renderCompletionScript } from './completions.js';
import type { CompletionShell } from './completions.js';

export const COMPLETIONS_BIN_NAME = 'trails';

const SHELLS = new Set<CompletionShell>(['bash', 'fish', 'zsh']);

const INSTALL_PATH_BY_SHELL: Readonly<Record<CompletionShell, string>> = {
  bash: '.local/share/bash-completion/completions/trails',
  fish: '.config/fish/completions/trails.fish',
  zsh: '.local/share/zsh/site-functions/_trails',
};

export interface CompletionsInstallOptions {
  readonly binName?: string | undefined;
  readonly homeDir?: string | undefined;
  readonly shell?: string | undefined;
  readonly shellEnv?: string | undefined;
}

export interface CompletionsInstallResult {
  readonly created: boolean;
  readonly message: string;
  readonly path: string;
  readonly shell: CompletionShell;
}

interface StdoutLike {
  write(chunk: string): unknown;
}

export interface AttachCompletionsInstallOptions {
  readonly binName?: string | undefined;
  readonly homeDir?: string | undefined;
  readonly shellEnv?: string | undefined;
  readonly stdout?: StdoutLike | undefined;
}

const isCompletionShell = (value: string): value is CompletionShell =>
  SHELLS.has(value as CompletionShell);

const detectShellFromEnv = (shellEnv: string): CompletionShell | null => {
  if (shellEnv.length === 0) {
    return null;
  }
  const slashIndex = shellEnv.lastIndexOf('/');
  const base = slashIndex === -1 ? shellEnv : shellEnv.slice(slashIndex + 1);
  return isCompletionShell(base) ? base : null;
};

const unsupportedShellMessage =
  'Could not detect shell from $SHELL. Pass --shell with one of: bash, zsh, fish.';

const resolveTargetShell = (input: {
  readonly shell?: string | undefined;
  readonly shellEnv?: string | undefined;
}): Result<CompletionShell, ValidationError> => {
  if (input.shell !== undefined) {
    if (isCompletionShell(input.shell)) {
      return Result.ok(input.shell);
    }
    return Result.err(
      new ValidationError(
        `Unsupported shell "${input.shell}". Pass one of: bash, zsh, fish.`
      )
    );
  }
  const envValue = input.shellEnv ?? process.env['SHELL'] ?? '';
  const detected = detectShellFromEnv(envValue);
  return detected === null
    ? Result.err(new ValidationError(unsupportedShellMessage))
    : Result.ok(detected);
};

const fileExists = async (path: string): Promise<boolean> =>
  await Bun.file(path).exists();

export const runCompletionsInstall = async (
  options: CompletionsInstallOptions = {}
): Promise<Result<CompletionsInstallResult, Error>> => {
  const shellResult = resolveTargetShell(options);
  if (shellResult.isErr()) {
    return shellResult;
  }

  const shell = shellResult.value;
  const home = options.homeDir ?? homedir();
  const path = join(home, INSTALL_PATH_BY_SHELL[shell]);
  const scriptResult = renderCompletionScript(
    shell,
    options.binName ?? COMPLETIONS_BIN_NAME
  );
  if (scriptResult.isErr()) {
    return scriptResult;
  }

  let existed: boolean;
  try {
    existed = await fileExists(path);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, scriptResult.value);
  } catch (error) {
    return Result.err(
      error instanceof Error ? error : new Error(String(error))
    );
  }
  const created = !existed;

  return Result.ok({
    created,
    message: created
      ? `Installed ${shell} completions to ${path}. Run \`exec $SHELL\` or restart your shell to activate.`
      : `Updated ${shell} completions at ${path}.`,
    path,
    shell,
  });
};

const handleCliError = (error: unknown): void => {
  const err = error instanceof Error ? error : new Error(String(error));
  const rendering = renderPublicSurfaceError('cli', err);
  process.stderr.write(`Error: ${rendering.message}\n`);
  process.exit(rendering.code);
};

const findCompletionsCommand = (program: Command): Command | undefined =>
  program.commands.find((command) => command.name() === 'completions');

export const attachCompletionsInstallCommand = (
  program: Command,
  options: AttachCompletionsInstallOptions = {}
): void => {
  const completionsCommand =
    findCompletionsCommand(program) ??
    program
      .command('completions')
      .description('Render and install shell completion scripts');

  completionsCommand
    .command('install')
    .description('Install a shell completion script for the trails CLI')
    .option(
      '-s, --shell <shell>',
      'Target shell; auto-detected from $SHELL when omitted.'
    )
    .action(async (flags: { readonly shell?: string | undefined }) => {
      const result = await runCompletionsInstall({
        binName: options.binName,
        homeDir: options.homeDir,
        shell: flags.shell,
        shellEnv: options.shellEnv,
      });
      if (result.isErr()) {
        handleCliError(result.error);
        return;
      }
      (options.stdout ?? process.stdout).write(`${result.value.message}\n`);
    });
};
