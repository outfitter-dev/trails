import {
  isProvenanceOnlyLockChange,
  readCommittedSkillsetLock,
} from './skillset-lock-provenance.js';

export const checkSkillsetLockProvenance = async (
  base: string,
  cwd = process.cwd()
): Promise<boolean> => {
  const [before, after] = await Promise.all([
    readCommittedSkillsetLock(base, cwd),
    readCommittedSkillsetLock('HEAD', cwd),
  ]);
  if (!isProvenanceOnlyLockChange(before, after)) {
    return true;
  }
  const quotedBase = `'${base.replaceAll("'", "'\\''")}'`;
  console.error(
    `skillset.lock contains only local checkout provenance changes. Restore the actual PR base (${base}) and verify:\n` +
      `git checkout ${quotedBase} -- skillset.lock && bun run skillset:check\n` +
      'For a standalone PR whose base is current origin/main, the equivalent recipe is:\n' +
      'git checkout origin/main -- skillset.lock && bun run skillset:check'
  );
  return false;
};

if (import.meta.main) {
  try {
    const [base] = process.argv.slice(2);
    if (!base) {
      throw new Error(
        'Usage: bun scripts/check-skillset-lock-provenance.ts <base-ref>'
      );
    }
    process.exitCode = (await checkSkillsetLockProvenance(base)) ? 0 : 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
