import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BOOTSTRAP_DIR } from './shared.js';

export interface BootstrapConfig {
  readonly bun: {
    readonly installDirDefault: string;
    readonly installDirEnv: string;
    readonly versionFile: string;
  };
  readonly checks: {
    readonly optionalTools: readonly string[];
    readonly requiredTools: readonly string[];
  };
  readonly cleanup: {
    readonly directories: readonly string[];
    readonly files: readonly string[];
  };
  readonly defaults: {
    readonly command: BootstrapCommand;
    readonly localBunPolicy: BunPolicy;
    readonly remoteBunPolicy: BunPolicy;
  };
  readonly graphite: {
    readonly enabledIfToolExists: boolean;
    readonly forbiddenLifecycleCommands: readonly string[];
  };
  readonly root: {
    readonly envVars: readonly string[];
    readonly fallbackToGitRoot: boolean;
  };
  readonly agent: {
    readonly graphiteStackMaxLines: number;
  };
}

export type BootstrapCommand =
  | 'agent'
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'doctor'
  | 'repo'
  | 'sweep'
  | 'teardown';
export type BunPolicy = 'compatible' | 'strict';

interface RawConfig {
  readonly agent?: { readonly graphite_stack_max_lines?: number };
  readonly bun?: {
    readonly install_dir_default?: string;
    readonly install_dir_env?: string;
    readonly version_file?: string;
  };
  readonly checks?: {
    readonly optional?: { readonly tools?: string[] };
    readonly required?: { readonly tools?: string[] };
  };
  readonly cleanup?: {
    readonly directories?: string[];
    readonly files?: string[];
  };
  readonly commands?: {
    readonly agent?: { readonly graphite_stack_max_lines?: number };
  };
  readonly defaults?: {
    readonly command?: BootstrapCommand;
    readonly local_bun_policy?: BunPolicy;
    readonly remote_bun_policy?: BunPolicy;
  };
  readonly graphite?: {
    readonly enabled_if_tool_exists?: boolean;
    readonly forbidden_lifecycle_commands?: string[];
  };
  readonly root?: {
    readonly env_vars?: string[];
    readonly fallback_to_git_root?: boolean;
  };
}

const configPath = join(BOOTSTRAP_DIR, 'config.toml');

const DEFAULT_OPTIONAL_TOOLS = [
  'git',
  'gh',
  'gt',
  'rg',
  'jq',
  'direnv',
] as const;

const DEFAULT_ROOT_ENV_VARS = [
  'CODEX_WORKTREE_PATH',
  'CLAUDE_PROJECT_DIR',
  'CLAUDECODE',
  'FACTORY_PROJECT_DIR',
  'GITHUB_WORKSPACE',
] as const;

const agentConfig = (raw: RawConfig): BootstrapConfig['agent'] => ({
  graphiteStackMaxLines:
    raw.commands?.agent?.graphite_stack_max_lines ??
    raw.agent?.graphite_stack_max_lines ??
    120,
});

const bunConfig = (raw: RawConfig): BootstrapConfig['bun'] => ({
  installDirDefault: raw.bun?.install_dir_default ?? '$HOME/.bun',
  installDirEnv: raw.bun?.install_dir_env ?? 'BUN_INSTALL',
  versionFile: raw.bun?.version_file ?? '.bun-version',
});

const checksConfig = (raw: RawConfig): BootstrapConfig['checks'] => ({
  optionalTools: raw.checks?.optional?.tools ?? DEFAULT_OPTIONAL_TOOLS,
  requiredTools: raw.checks?.required?.tools ?? ['bun'],
});

const cleanupConfig = (raw: RawConfig): BootstrapConfig['cleanup'] => ({
  directories: raw.cleanup?.directories ?? [],
  files: raw.cleanup?.files ?? [],
});

const defaultsConfig = (raw: RawConfig): BootstrapConfig['defaults'] => ({
  command: raw.defaults?.command ?? 'repo',
  localBunPolicy: raw.defaults?.local_bun_policy ?? 'compatible',
  remoteBunPolicy: raw.defaults?.remote_bun_policy ?? 'strict',
});

const graphiteConfig = (raw: RawConfig): BootstrapConfig['graphite'] => ({
  enabledIfToolExists: raw.graphite?.enabled_if_tool_exists ?? true,
  forbiddenLifecycleCommands: raw.graphite?.forbidden_lifecycle_commands ?? [],
});

const rootConfig = (raw: RawConfig): BootstrapConfig['root'] => ({
  envVars: raw.root?.env_vars ?? DEFAULT_ROOT_ENV_VARS,
  fallbackToGitRoot: raw.root?.fallback_to_git_root ?? true,
});

export const loadBootstrapConfig = (): BootstrapConfig => {
  const raw = Bun.TOML.parse(readFileSync(configPath, 'utf8')) as RawConfig;

  return {
    agent: agentConfig(raw),
    bun: bunConfig(raw),
    checks: checksConfig(raw),
    cleanup: cleanupConfig(raw),
    defaults: defaultsConfig(raw),
    graphite: graphiteConfig(raw),
    root: rootConfig(raw),
  };
};
