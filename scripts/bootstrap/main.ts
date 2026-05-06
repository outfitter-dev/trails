import type { BootstrapCommand } from './config.js';
import { detectHost, resolveRepoRoot } from './host.js';
import { loadBootstrapConfig } from './config.js';
import { runAgentBootstrap } from './agent.js';
import { runDoctor } from './doctor.js';
import { runRepoBootstrap } from './repo.js';
import { runSweep } from './sweep.js';

export interface ParsedBootstrapArgs {
  readonly command: BootstrapCommand;
  readonly force: boolean;
  readonly update: boolean;
}

const COMMANDS: ReadonlySet<string> = new Set([
  'agent',
  'doctor',
  'repo',
  'sweep',
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
    update,
  };
};

export const printUsage = (): void => {
  console.error(`Usage: ./scripts/bootstrap.sh [repo|agent|doctor|sweep] [--force] [--update]

Commands:
  repo     Make this checkout runnable (default)
  agent    Repo bootstrap plus agent lifecycle diagnostics
  doctor   Diagnostics only; no install, cleanup, or mutation
  sweep    Conservative cleanup of configured runtime artifacts only

Compatibility:
  ./scripts/bootstrap.sh --force
  ./scripts/bootstrap.sh --update`);
};

const runMain = async (): Promise<void> => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const config = loadBootstrapConfig();
  const parsed = parseBootstrapArgs(process.argv.slice(2));
  const host = detectHost(process.env, config);
  const repoRoot = resolveRepoRoot(process.cwd(), process.env, config);

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
    case 'doctor': {
      await runDoctor(repoRoot, config, host);
      return;
    }
    case 'sweep': {
      runSweep(repoRoot, config);
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
