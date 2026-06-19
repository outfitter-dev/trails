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

export type WayfinderFactDriftStatus = 'absent' | 'aligned' | 'drifted';

export interface WayfinderFactDrift {
  readonly artifacts?: readonly WayfinderArtifactKind[] | undefined;
  readonly freshness: WayfinderFreshness;
  readonly reasons?: readonly WayfinderStaleReason[] | undefined;
  readonly status: WayfinderFactDriftStatus;
}

export interface WayfinderFact<TValue> {
  readonly category: WayfinderFactCategory;
  readonly derivedFrom: WayfinderContractRef | null;
  readonly drift: WayfinderFactDrift;
  readonly freshness: WayfinderFreshness;
  readonly source: WayfinderArtifactSource;
  readonly value: TValue;
}

export type WayfinderFactInput<TValue> = Omit<
  WayfinderFact<TValue>,
  'drift'
> & {
  readonly drift?: WayfinderFactDrift | undefined;
};

export const wayfinderDriftFromFreshness = (
  freshness: WayfinderFreshness
): WayfinderFactDrift => {
  switch (freshness.status) {
    case 'fresh': {
      return { freshness, status: 'aligned' };
    }
    case 'missing': {
      return {
        artifacts: freshness.artifacts,
        freshness,
        status: 'absent',
      };
    }
    case 'schema-version-drift':
    case 'stale': {
      return {
        ...(freshness.status === 'stale' ? { reasons: freshness.reasons } : {}),
        freshness,
        status: 'drifted',
      };
    }
    default: {
      freshness satisfies never;
      return { freshness, status: 'drifted' };
    }
  }
};

export const wayfinderFact = <TValue>(
  fact: WayfinderFactInput<TValue>
): WayfinderFact<TValue> => ({
  ...fact,
  drift: fact.drift ?? wayfinderDriftFromFreshness(fact.freshness),
});
