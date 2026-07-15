import type { AnyTrail, TrailVersionStatus } from './trail.js';
import {
  deriveSupportedTrailVersions,
  isDeprecatedTrailVersionEntry,
} from './trail.js';
import { deriveTrailVersionMarkers } from './version-marker.js';

export interface SurfaceTrailVersionRendering {
  readonly current: boolean;
  readonly deprecated: boolean;
  readonly marker?: string | undefined;
  readonly status?: TrailVersionStatus | undefined;
  readonly version: number;
}

export const deriveSurfaceTrailVersionRenderings = (
  trail: AnyTrail
): readonly SurfaceTrailVersionRendering[] | undefined => {
  if (trail.version === undefined) {
    return undefined;
  }

  const markers = new Map(
    deriveTrailVersionMarkers(trail).map((record) => [
      record.version,
      record.marker,
    ])
  );

  return deriveSupportedTrailVersions(trail).map((version) => {
    const entry = trail.versions?.[version];
    const marker = markers.get(version);
    return {
      current: version === trail.version,
      deprecated:
        entry === undefined ? false : isDeprecatedTrailVersionEntry(entry),
      ...(marker === undefined ? {} : { marker }),
      ...(entry?.status === undefined ? {} : { status: entry.status }),
      version,
    };
  });
};
