import type { BootstrapCommand } from './config.js';
import { detectHost, resolveRepoRoot } from './host.js';
import { loadBootstrapConfig } from './config.js';
import { runAgentBootstrap } from './agent.js';
import { runDoctor } from './doctor.js';
import { runRepoBootstrap } from './repo.js';
import { runTeardown } from './sweep.js';

export interface ParsedBootstrapArgs {
  readonly command: BootstrapCommand;
  readonly force: boolean;
  readonly provider: 'claude' | 'codex' | 'cursor' | undefined;
  readonly update: boolean;
}

const COMMANDS: ReadonlySet<string> = new Set([
  'agent',
  'claude',
  'codex',
  'cursor',
  'doctor',
  'repo',
  'sweep',
  'teardown',
]);

export const parseBootstrapArgs = (
  args: readonly string[]
): ParsedBootstrapArgs => {
  const [first, ...rest] = args;
  const command = COMMANDS.has(first ?? '') ? first : 'repo';
  const flags = command === first ? rest : args;
  let force = false;
  let update = false;

  for (const flag of flags) {
    switch (flag) {
      case '--force': {
        force = true;
        break;
      }
      case '--update': {
        update = true;
        break;
      }
      case '-h':
      case '--help': {
        break;
      }
      default: {
        throw new Error(`Unknown bootstrap option: ${flag}`);
      }
    }
  }

  return {
    command: command as BootstrapCommand,
    force,
    provider:
      command === 'claude' || command === 'codex' || command === 'cursor'
        ? command
        : undefined,
    update,
  };
};

export const printUsage = (): void => {
  console.error(`Usage: ./scripts/bootstrap.sh [repo|agent|codex|claude|cursor|doctor|teardown] [--force] [--update]

Commands:
  repo     Make this checkout runnable (default)
  agent    Repo bootstrap plus agent lifecycle diagnostics
  codex    Codex agent bootstrap with provider-specific root detection
  claude   Claude agent bootstrap with provider-specific root detection
  cursor   Cursor agent bootstrap with provider-specific root detection
  doctor   Diagnostics only; no install, cleanup, or mutation
  teardown Conservative cleanup of configured runtime artifacts only

Compatibility:
  ./scripts/bootstrap.sh --force
  ./scripts/bootstrap.sh --update
  ./scripts/bootstrap.sh sweep`);
};

const runMain = async (): Promise<void> => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const config = loadBootstrapConfig();
  const parsed = parseBootstrapArgs(process.argv.slice(2));
  const env =
    parsed.provider === undefined
      ? process.env
      : {
          ...process.env,
          TRAILS_AGENT_ENV_PROVIDER: parsed.provider,
        };
  const host = detectHost(env, config);
  const repoRoot = resolveRepoRoot(process.cwd(), env, config, host.provider);

  switch (parsed.command) {
    case 'repo': {
      await runRepoBootstrap({
        config,
        force: parsed.force,
        host,
        repoRoot,
        update: parsed.update,
      });
      return;
    }
    case 'agent': {
      await runAgentBootstrap({
        config,
        force: parsed.force,
        host,
        repoRoot,
        update: parsed.update,
      });
      return;
    }
    case 'codex':
    case 'claude':
    case 'cursor': {
      await runAgentBootstrap({
        config,
        force: true,
        host,
        repoRoot,
        update: parsed.update,
      });
      return;
    }
    case 'doctor': {
      await runDoctor(repoRoot, config, host);
      return;
    }
    case 'sweep':
    case 'teardown': {
      runTeardown(repoRoot, config);
      return;
    }
    default: {
      const exhaustive: never = parsed.command;
      throw new Error(`Unknown bootstrap command: ${exhaustive}`);
    }
  }
};

if (import.meta.main) {
  try {
    await runMain();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
