import { runLockRoundtripSmoke } from './lock-roundtrip-smoke.js';
import type { LockRoundtripSmokeResult } from './lock-roundtrip-smoke.js';
import { runPackedArtifactsSmoke } from './packed-artifacts-smoke.js';
import type { PackedArtifactsSmokeResult } from './packed-artifacts-smoke.js';
import { runWayfinderDogfoodSmoke } from './wayfinder-dogfood-smoke.js';
import type { WayfinderDogfoodSmokeResult } from './wayfinder-dogfood-smoke.js';

export const releaseSmokeCheckValues = [
  'all',
  'lock-roundtrip',
  'packed-artifacts',
  'wayfinder-dogfood',
] as const;
export type ReleaseSmokeCheck = (typeof releaseSmokeCheckValues)[number];

export type ReleaseSmokeCheckResult =
  | LockRoundtripSmokeResult
  | PackedArtifactsSmokeResult
  | WayfinderDogfoodSmokeResult;

export interface ReleaseSmokeResult {
  readonly checks: readonly ReleaseSmokeCheckResult[];
  readonly message: string;
  readonly passed: true;
}

const checksForInput = (
  check: ReleaseSmokeCheck
): readonly Exclude<ReleaseSmokeCheck, 'all'>[] =>
  check === 'all'
    ? ['lock-roundtrip', 'packed-artifacts', 'wayfinder-dogfood']
    : [check];

export const runReleaseSmoke = async (
  check: ReleaseSmokeCheck
): Promise<ReleaseSmokeResult> => {
  const results: ReleaseSmokeCheckResult[] = [];

  for (const selectedCheck of checksForInput(check)) {
    if (selectedCheck === 'lock-roundtrip') {
      results.push(await runLockRoundtripSmoke());
      continue;
    }
    if (selectedCheck === 'packed-artifacts') {
      results.push(await runPackedArtifactsSmoke());
      continue;
    }
    results.push(await runWayfinderDogfoodSmoke());
  }

  return {
    checks: results,
    message: results.map((result) => result.message).join('\n'),
    passed: true,
  };
};
