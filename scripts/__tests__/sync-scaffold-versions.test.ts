import { describe, expect, test } from 'bun:test';

import { diagnoseOntrailsPackagePin } from '../sync-scaffold-versions.ts';

describe('sync-scaffold-versions', () => {
  test('accepts exact generated @ontrails package pins', () => {
    expect(
      diagnoseOntrailsPackagePin({
        ontrailsPackageRange: '1.0.0-beta.18',
        trailsPackageVersion: '1.0.0-beta.18',
      })
    ).toBeUndefined();
  });

  test('rejects caret prerelease ranges for generated @ontrails packages', () => {
    expect(
      diagnoseOntrailsPackagePin({
        ontrailsPackageRange: '^1.0.0-beta.18',
        trailsPackageVersion: '1.0.0-beta.18',
      })
    ).toContain('must be exact pins');
  });

  test('rejects plain version drift for generated @ontrails packages', () => {
    expect(
      diagnoseOntrailsPackagePin({
        ontrailsPackageRange: '1.0.0-beta.17',
        trailsPackageVersion: '1.0.0-beta.18',
      })
    ).toContain('must be exact pins');
  });

  test('requires both scaffold version exports', () => {
    expect(diagnoseOntrailsPackagePin({})).toContain(
      'must export `ontrailsPackageRange` and `trailsPackageVersion`'
    );
  });
});
