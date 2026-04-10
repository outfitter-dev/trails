import type { Trail } from './trail.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TrailheadFilterOptions {
  /** Glob patterns that keep only matching trail IDs when provided. */
  readonly include?: readonly string[] | undefined;
  /** Glob patterns that remove matching trail IDs. */
  readonly exclude?: readonly string[] | undefined;
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

const trailIdSegments = (trailId: string): readonly string[] =>
  trailId.split('.');

const patternSegments = (pattern: string): readonly string[] =>
  pattern.split('.');

type SegmentMatcher = (
  trail: readonly string[],
  pattern: readonly string[],
  trailIndex: number,
  patternIndex: number
) => boolean;

const matchesDoubleStar = (
  trail: readonly string[],
  pattern: readonly string[],
  trailIndex: number,
  patternIndex: number,
  matchSegments: SegmentMatcher
): boolean =>
  patternIndex === pattern.length - 1 ||
  Array.from(
    { length: trail.length - trailIndex + 1 },
    (_, offset) => trailIndex + offset
  ).some((index) => matchSegments(trail, pattern, index, patternIndex + 1));

const matchesSingleSegment = (
  trail: readonly string[],
  pattern: readonly string[],
  trailIndex: number,
  patternIndex: number,
  current: string,
  matchSegments: SegmentMatcher
): boolean =>
  trailIndex < trail.length &&
  (current === '*' || current === trail[trailIndex]) &&
  matchSegments(trail, pattern, trailIndex + 1, patternIndex + 1);

const matchesFrom = function matchesFrom(
  trail: readonly string[],
  pattern: readonly string[],
  trailIndex: number,
  patternIndex: number
): boolean {
  if (patternIndex >= pattern.length) {
    return trailIndex >= trail.length;
  }

  const current = pattern[patternIndex];
  if (current === undefined) {
    return false;
  }

  return current === '**'
    ? matchesDoubleStar(trail, pattern, trailIndex, patternIndex, matchesFrom)
    : matchesSingleSegment(
        trail,
        pattern,
        trailIndex,
        patternIndex,
        current,
        matchesFrom
      );
};

export const matchesTrailPattern = (
  trailId: string,
  pattern: string
): boolean => {
  if (pattern === trailId) {
    return true;
  }
  return matchesFrom(trailIdSegments(trailId), patternSegments(pattern), 0, 0);
};

// ---------------------------------------------------------------------------
// Trailhead filtering
// ---------------------------------------------------------------------------

const matchesAnyPattern = (
  trailId: string,
  patterns: readonly string[] | undefined
): boolean =>
  patterns !== undefined &&
  patterns.some((pattern) => matchesTrailPattern(trailId, pattern));

const isExplicitInternalInclude = (
  trailId: string,
  include: readonly string[] | undefined
): boolean => include !== undefined && include.includes(trailId);

const isVisibleToTrailheads = (
  trail: Trail<unknown, unknown, unknown>,
  include: readonly string[] | undefined
): boolean =>
  trail.visibility !== 'internal' ||
  isExplicitInternalInclude(trail.id, include);

const passesIncludeFilter = (
  trailId: string,
  include: readonly string[] | undefined
): boolean =>
  include === undefined ||
  include.length === 0 ||
  matchesAnyPattern(trailId, include);

export const shouldIncludeTrailForTrailhead = (
  trail: Trail<unknown, unknown, unknown>,
  options: TrailheadFilterOptions = {}
): boolean => {
  if (trail.on.length > 0) {
    return false;
  }

  const { exclude, include } = options;
  if (!isVisibleToTrailheads(trail, include)) {
    return false;
  }

  if (matchesAnyPattern(trail.id, exclude)) {
    return false;
  }

  return passesIncludeFilter(trail.id, include);
};

export const filterTrailheadTrails = (
  trails: readonly Trail<unknown, unknown, unknown>[],
  options: TrailheadFilterOptions = {}
): Trail<unknown, unknown, unknown>[] =>
  trails.filter((trail) => shouldIncludeTrailForTrailhead(trail, options));
