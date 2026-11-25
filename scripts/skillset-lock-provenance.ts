import { isDeepStrictEqual } from 'node:util';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withoutCheckoutProvenance = (value: unknown): JsonRecord => {
  if (
    !isRecord(value) ||
    !isRecord(value.marketplaces) ||
    !Array.isArray(value.marketplaces.entries)
  ) {
    throw new Error('Expected a Skillset lock with marketplace entries');
  }
  const normalized = structuredClone(value);
  delete normalized.provenanceHash;
  for (const entry of (normalized.marketplaces as JsonRecord)
    .entries as unknown[]) {
    if (
      isRecord(entry) &&
      isRecord(entry.requested) &&
      entry.requested.kind === 'local' &&
      isRecord(entry.resolved) &&
      entry.resolved.sourceKind === 'current'
    ) {
      delete entry.resolved.ref;
      delete entry.resolved.sha;
    }
  }
  return normalized;
};

/**
 * Compare committed/generated locks without hiding content changes.
 * Unlike check-skillset-outputs.ts:64, this compares two live locks, so cache
 * paths and generated manifest paths must remain significant.
 */
export const isProvenanceOnlyLockChange = (
  before: string,
  after: string
): boolean => {
  const left: unknown = JSON.parse(before);
  const right: unknown = JSON.parse(after);
  return (
    !isDeepStrictEqual(left, right) &&
    isDeepStrictEqual(
      withoutCheckoutProvenance(left),
      withoutCheckoutProvenance(right)
    )
  );
};

export const readCommittedSkillsetLock = async (
  ref: string,
  cwd: string
): Promise<string> => {
  const child = Bun.spawn(['git', 'show', `${ref}:skillset.lock`], {
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(`Cannot read skillset.lock at ${ref}: ${stderr}`);
  }
  return stdout;
};
