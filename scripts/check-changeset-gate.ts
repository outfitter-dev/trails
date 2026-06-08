import { resolve } from 'node:path';

import { runReleaseCheckCli } from '@ontrails/trails/release';

export {
  checkReleaseRules,
  discoverWorkspaces,
  type ReleaseCheckInput,
  type ReleaseCheckResult,
  type WorkspaceInfo,
} from '@ontrails/trails/release';

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const repoRootArgs = args.includes('--repo-root')
      ? args
      : [...args, '--repo-root', resolve(import.meta.dir, '..')];

    process.exit(await runReleaseCheckCli(repoRootArgs));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
