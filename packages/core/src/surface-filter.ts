import type { Intent, Trail } from './trail.js';
import { matchesAnyTrailIdGlob, matchesTrailIdGlob } from './trail-id-glob.js';
import type { SurfaceSelectionOptions } from './surface-derivation.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SurfaceFilterOptions = SurfaceSelectionOptions;

export const matchesTrailPattern = (
  trailId: string,
  pattern: string
): boolean => matchesTrailIdGlob(trailId, pattern);

// ---------------------------------------------------------------------------
// Surface filtering
// ---------------------------------------------------------------------------

const matchesAnyPattern = (
  trailId: string,
  patterns: readonly string[] | undefined
): boolean => matchesAnyTrailIdGlob(trailId, patterns);

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
 * field was introduced (e.g. `meta: { internal: true }`) off surfaces.
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

const isVisibleToSurfaces = (
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
  if (trail.activationSources.length > 0) {
    return false;
  }

  const { exclude, include, intent } = options;
  if (!isVisibleToSurfaces(trail, include)) {
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
