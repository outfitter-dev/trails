import type { Intent, Trail } from './trail.js';
import type { SurfaceSelectionOptions } from './surface-derivation.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SurfaceFilterOptions = SurfaceSelectionOptions;

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

/**
 * Resolve the effective visibility for a trail.
 *
 * Returns `'internal'` when either the explicit `visibility` field is
 * `'internal'` or the legacy `meta.internal === true` convention is set.
 * Honoring the legacy flag keeps trails authored before the visibility
 * field was introduced (e.g. `meta: { internal: true }`) off trailheads.
 *
 * The runtime always fills in `visibility: 'public'` when the spec did not
 * declare it, so we cannot distinguish explicit `'public'` from the default.
 * This means a trail that sets both `meta.internal = true` and
 * `visibility: 'public'` will still be treated as internal — that
 * combination has never been a documented override and, if the author
 * really means "public", they should remove the legacy flag.
 */
const effectiveVisibility = (
  trail: Trail<unknown, unknown, unknown>
): 'public' | 'internal' => {
  if (trail.visibility === 'internal') {
    return 'internal';
  }
  return trail.meta?.['internal'] === true ? 'internal' : 'public';
};

const isVisibleToTrailheads = (
  trail: Trail<unknown, unknown, unknown>,
  include: readonly string[] | undefined
): boolean =>
  effectiveVisibility(trail) !== 'internal' ||
  isExplicitInternalInclude(trail.id, include);

const passesIncludeFilter = (
  trailId: string,
  include: readonly string[] | undefined
): boolean =>
  include === undefined ||
  include.length === 0 ||
  matchesAnyPattern(trailId, include);

const passesIntentFilter = (
  trail: Trail<unknown, unknown, unknown>,
  intent: readonly Intent[] | undefined
): boolean =>
  intent === undefined || intent.length === 0 || intent.includes(trail.intent);

export const shouldIncludeTrailForSurface = (
  trail: Trail<unknown, unknown, unknown>,
  options: SurfaceFilterOptions = {}
): boolean => {
  if (trail.on.length > 0) {
    return false;
  }

  const { exclude, include, intent } = options;
  if (!isVisibleToTrailheads(trail, include)) {
    return false;
  }

  if (matchesAnyPattern(trail.id, exclude)) {
    return false;
  }

  return (
    passesIncludeFilter(trail.id, include) && passesIntentFilter(trail, intent)
  );
};

export const filterSurfaceTrails = (
  trails: readonly Trail<unknown, unknown, unknown>[],
  options: SurfaceFilterOptions = {}
): Trail<unknown, unknown, unknown>[] =>
  trails.filter((trail) => shouldIncludeTrailForSurface(trail, options));
