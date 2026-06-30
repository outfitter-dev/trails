import { resolve } from 'node:path';

import type { BootstrapConfig, BunPolicy } from './config.js';
import { DEFAULT_REPO_ROOT, isRepoRoot, run } from './shared.js';

export type HostProvider =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'devin'
  | 'factory'
  | 'generic';

export interface HostInfo {
  readonly provider: HostProvider;
  readonly remote: boolean;
  readonly bunPolicy: BunPolicy;
}

const readBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
};

const detectProvider = (env: NodeJS.ProcessEnv): HostProvider => {
  const explicitProvider = env['TRAILS_AGENT_ENV_PROVIDER'] as
    | HostProvider
    | undefined;
  if (explicitProvider !== undefined) {
    return explicitProvider;
  }
  if (env['CODEX_WORKTREE_PATH'] !== undefined) {
    return 'codex';
  }
  if (
    env['CLAUDE_PROJECT_DIR'] !== undefined ||
    env['CLAUDECODE'] !== undefined
  ) {
    return 'claude';
  }
  if (env['CURSOR_AGENT'] !== undefined) {
    return 'cursor';
  }
  if (env['FACTORY_PROJECT_DIR'] !== undefined) {
    return 'factory';
  }
  if (env['GITHUB_WORKSPACE'] !== undefined) {
    return 'devin';
  }
  return 'generic';
};

const providerRootEnvVars = (
  provider: HostProvider | undefined
): readonly string[] => {
  switch (provider) {
    case 'codex': {
      return ['CODEX_WORKTREE_PATH'];
    }
    case 'claude': {
      return ['CLAUDE_PROJECT_DIR', 'CLAUDECODE'];
    }
    case 'cursor': {
      // Cursor cloud agents run from the workspace checkout itself; the repo
      // root resolves from cwd / git root rather than a dedicated env var.
      return [];
    }
    case 'factory': {
      return ['FACTORY_PROJECT_DIR'];
    }
    case 'devin': {
      return ['GITHUB_WORKSPACE'];
    }
    case 'generic':
    case undefined: {
      return [];
    }
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
};

export const detectHost = (
  env: NodeJS.ProcessEnv,
  config: BootstrapConfig
): HostInfo => {
  const provider = detectProvider(env);

  const explicitRemote = readBoolean(env['TRAILS_AGENT_ENV_REMOTE']);
  const remote =
    explicitRemote ??
    (env['CLAUDE_CODE_REMOTE'] === 'true' ||
      provider === 'cursor' ||
      env['GITHUB_ACTIONS'] === 'true' ||
      env['CI'] === 'true');
  const explicitPolicy = env['TRAILS_AGENT_BUN_POLICY'] as
    | BunPolicy
    | undefined;

  return {
    bunPolicy:
      explicitPolicy ??
      (remote
        ? config.defaults.remoteBunPolicy
        : config.defaults.localBunPolicy),
    provider,
    remote,
  };
};

export const resolveRepoRoot = (
  cwd: string,
  env: NodeJS.ProcessEnv,
  config: BootstrapConfig,
  provider?: HostProvider
): string => {
  const providerEnvVars = providerRootEnvVars(provider);
  const orderedEnvVars =
    provider === 'cursor'
      ? providerEnvVars
      : [
          ...providerEnvVars,
          ...config.root.envVars.filter(
            (name) => !providerEnvVars.includes(name)
          ),
        ];

  for (const name of orderedEnvVars) {
    const candidate = env[name];
    if (candidate !== undefined && isRepoRoot(candidate)) {
      return resolve(candidate);
    }
  }

  if (isRepoRoot(cwd)) {
    return resolve(cwd);
  }

  if (config.root.fallbackToGitRoot) {
    const result = run(['git', 'rev-parse', '--show-toplevel'], cwd);
    const candidate = result.stdout.trim();
    if (result.exitCode === 0 && isRepoRoot(candidate)) {
      return resolve(candidate);
    }
  }

  return DEFAULT_REPO_ROOT;
};
