import type { BootstrapConfig } from './config.js';
import type { HostInfo } from './host.js';
import { printAgentGitDiagnostics } from './git.js';
import { runRepoBootstrap } from './repo.js';

export interface AgentBootstrapOptions {
  readonly config: BootstrapConfig;
  readonly force: boolean;
  readonly host: HostInfo;
  readonly repoRoot: string;
  readonly update: boolean;
}

export const runAgentBootstrap = async (
  options: AgentBootstrapOptions
): Promise<void> => {
  await runRepoBootstrap(options);
  printAgentGitDiagnostics(
    options.repoRoot,
    options.config.agent.graphiteStackMaxLines
  );
};
