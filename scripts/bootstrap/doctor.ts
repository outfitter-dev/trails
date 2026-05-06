import type { BootstrapConfig } from './config.js';
import type { HostInfo } from './host.js';
import { checkBunVersion } from './bun.js';
import { hasRepoInstallState } from './repo.js';
import { collectToolStatus, printToolStatuses } from './tools.js';

export const runDoctor = async (
  repoRoot: string,
  config: BootstrapConfig,
  host: HostInfo
): Promise<void> => {
  console.error('Trails Bootstrap Doctor');
  console.error('───────────────────────');
  console.error(`repo root: ${repoRoot}`);
  console.error(`provider: ${host.provider}`);
  console.error(`remote: ${String(host.remote)}`);

  const bun = checkBunVersion(repoRoot, host.bunPolicy, config.bun.versionFile);
  console.error('');
  console.error('Required checks');
  console.error(
    `  bun: ${bun.ok ? 'ok' : 'failed'}${bun.actual ? ` ${bun.actual}` : ''} (${bun.policy}; pinned ${bun.pinned})`
  );
  console.error(
    `  dependencies: ${(await hasRepoInstallState(repoRoot)) ? 'ok' : 'missing'}`
  );

  console.error('');
  printToolStatuses(
    'Optional capabilities',
    collectToolStatus(config.checks.optionalTools, repoRoot),
    true
  );
};
