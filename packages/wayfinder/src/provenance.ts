export type WayfinderFactCategory =
  | 'authored'
  | 'projected'
  | 'inferred'
  | 'observed';

export type WayfinderArtifactKind = 'lockManifest' | 'topoGraph' | 'topoStore';

export interface WayfinderArtifactSource {
  readonly kind: WayfinderArtifactKind;
  readonly path?: string | undefined;
  readonly schemaVersion?: number | undefined;
}

export interface WayfinderContractRef {
  readonly id: string;
  readonly kind: 'contour' | 'facet' | 'resource' | 'signal' | 'topo' | 'trail';
  readonly field?: string | undefined;
}

export interface WayfinderFreshnessFresh {
  readonly status: 'fresh';
}

export interface WayfinderFreshnessMissing {
  readonly artifacts: readonly WayfinderArtifactKind[];
  readonly status: 'missing';
}

export type WayfinderStaleReason =
  | {
      readonly actual: string;
      readonly expected: string;
      readonly reason: 'lock-manifest-hash-mismatch';
    }
  | {
      readonly actual: Readonly<Record<string, number>>;
      readonly expected: Readonly<Record<string, number>>;
      readonly reason: 'lock-manifest-summary-mismatch';
    }
  | {
      readonly reason: 'lock-manifest-topo-artifact-missing';
    }
  | {
      readonly actual: string;
      readonly expected: string;
      readonly reason: 'topo-store-hash-mismatch';
      readonly snapshotId: string;
    }
  | {
      readonly reason: 'topo-store-export-missing';
    };

export interface WayfinderFreshnessStale {
  readonly reasons: readonly WayfinderStaleReason[];
  readonly status: 'stale';
}

export interface WayfinderFreshnessSchemaVersionDrift {
  readonly artifact: WayfinderArtifactKind;
  readonly message: string;
  readonly status: 'schema-version-drift';
}

export type WayfinderFreshness =
  | WayfinderFreshnessFresh
  | WayfinderFreshnessMissing
  | WayfinderFreshnessStale
  | WayfinderFreshnessSchemaVersionDrift;

export interface WayfinderFact<TValue> {
  readonly category: WayfinderFactCategory;
  readonly derivedFrom: WayfinderContractRef | null;
  readonly freshness: WayfinderFreshness;
  readonly source: WayfinderArtifactSource;
  readonly value: TValue;
}

export const wayfinderFact = <TValue>(
  fact: WayfinderFact<TValue>
): WayfinderFact<TValue> => fact;
