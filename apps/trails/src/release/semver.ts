/**
 * Minimal semver comparison shared across release tooling.
 *
 * Extracted from `policy.ts` so the release policy engine and the registry
 * classifier compare versions through one implementation instead of two.
 */

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | undefined;
}

export const parseSemver = (version: string): ParsedSemver | undefined => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u);
  if (!match) {
    return;
  }
  const [, major, minor, patch, prerelease] = match;
  if (!major || !minor || !patch) {
    return;
  }
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    prerelease,
  };
};

const parsePrerelease = (value: string): (number | string)[] =>
  value
    .split('.')
    .map((part) => (/^[0-9]+$/u.test(part) ? Number.parseInt(part, 10) : part));

const comparePrerelease = (leftValue: string, rightValue: string): number => {
  const left = parsePrerelease(leftValue);
  const right = parsePrerelease(rightValue);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart - rightPart;
    }
    if (typeof leftPart === 'number') {
      return -1;
    }
    if (typeof rightPart === 'number') {
      return 1;
    }
    const delta = leftPart.localeCompare(rightPart);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
};

/**
 * Compare two semver strings. Returns a negative number when `leftVersion`
 * sorts before `rightVersion`, a positive number when it sorts after, and 0
 * when equal. Unparseable inputs fall back to a locale comparison.
 */
export const compareSemver = (
  leftVersion: string,
  rightVersion: string
): number => {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) {
    return leftVersion.localeCompare(rightVersion);
  }

  for (const key of ['major', 'minor', 'patch'] as const) {
    const delta = left[key] - right[key];
    if (delta !== 0) {
      return delta;
    }
  }

  if (left.prerelease === right.prerelease) {
    return 0;
  }
  if (!left.prerelease) {
    return 1;
  }
  if (!right.prerelease) {
    return -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
};
