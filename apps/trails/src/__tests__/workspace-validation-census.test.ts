import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

interface CensusProbeOutput {
  readonly calls: readonly {
    readonly currentAppGraphHashIds: readonly string[];
    readonly selectedAppIds: readonly string[] | null;
  }[];
  readonly isOk: boolean;
}

const runCensusProbe = (appCount: number): CensusProbeOutput => {
  const probe = Bun.spawnSync({
    cmd: [
      process.execPath,
      join(import.meta.dir, 'fixtures', 'workspace-validation-census-probe.ts'),
      String(appCount),
    ],
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (!probe.success) {
    throw new Error(Buffer.from(probe.stderr).toString('utf8'));
  }
  return JSON.parse(
    Buffer.from(probe.stdout).toString('utf8')
  ) as CensusProbeOutput;
};

describe('workspace validation census', () => {
  test('full workspace derivations stay constant as configured apps grow', () => {
    const twoApps = runCensusProbe(2);
    const threeApps = runCensusProbe(3);

    expect(twoApps.isOk).toBe(true);
    expect(threeApps.isOk).toBe(true);
    expect(twoApps.calls).toHaveLength(2);
    expect(threeApps.calls).toHaveLength(twoApps.calls.length);
    expect(twoApps.calls).toEqual([
      {
        currentAppGraphHashIds: [],
        selectedAppIds: ['a', 'b'],
      },
      {
        currentAppGraphHashIds: ['a', 'b'],
        selectedAppIds: null,
      },
    ]);
    expect(threeApps.calls.at(-1)).toEqual({
      currentAppGraphHashIds: ['a', 'b', 'c'],
      selectedAppIds: null,
    });
  });
});
