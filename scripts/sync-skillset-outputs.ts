import { join } from 'node:path';

import {
  isProvenanceOnlyLockChange,
  readCommittedSkillsetLock,
} from './skillset-lock-provenance.js';

export const syncSkillsetOutputs = async (
  cwd = process.cwd()
): Promise<number> => {
  const lockPath = join(cwd, 'skillset.lock');
  const before = await Bun.file(lockPath).text();
  const committed = await readCommittedSkillsetLock('HEAD', cwd);
  for (const command of [
    ['bun', 'run', 'warden:skills:sync'],
    ['skillset', 'build', '--yes', '--root', '.'],
    ['skillset', 'marketplace', 'update', 'trails', '--yes', '--root', '.'],
  ]) {
    const child = Bun.spawn(command, {
      cwd,
      stderr: 'inherit',
      stdout: 'inherit',
    });
    const code = await child.exited;
    if (code !== 0) {
      return code;
    }
  }
  const generated = await Bun.file(lockPath).text();
  // Never discard lock edits that preceded this invocation. Real content and
  // external provenance always remain generator-owned, even with a clean lock.
  if (
    before === committed &&
    isProvenanceOnlyLockChange(committed, generated)
  ) {
    await Bun.write(lockPath, committed);
    console.log(
      'skillset: preserved committed lock; only local checkout provenance changed'
    );
  }
  return 0;
};

if (import.meta.main) {
  try {
    process.exitCode = await syncSkillsetOutputs();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
