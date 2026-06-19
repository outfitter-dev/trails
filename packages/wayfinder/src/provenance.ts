export type WayfinderFactCategory =
  | 'authored'
  | 'derived'
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

export interface WayfinderArtifactStatusFresh {
  readonly status: 'fresh';
}

export interface WayfinderArtifactStatusMissing {
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

export interface WayfinderArtifactStatusStale {
  readonly reasons: readonly WayfinderStaleReason[];
  readonly status: 'stale';
}

export interface WayfinderArtifactStatusSchemaVersionDrift {
  readonly artifact: WayfinderArtifactKind;
  readonly message: string;
  readonly status: 'schema-version-drift';
}

export type WayfinderArtifactStatus =
  | WayfinderArtifactStatusFresh
  | WayfinderArtifactStatusMissing
  | WayfinderArtifactStatusStale
  | WayfinderArtifactStatusSchemaVersionDrift;

export type WayfinderFreshnessFresh = WayfinderArtifactStatusFresh;
export type WayfinderFreshnessMissing = WayfinderArtifactStatusMissing;
export type WayfinderFreshnessStale = WayfinderArtifactStatusStale;
export type WayfinderFreshnessSchemaVersionDrift =
  WayfinderArtifactStatusSchemaVersionDrift;
export type WayfinderFreshness = WayfinderArtifactStatus;

export type WayfinderFactDriftStatus = 'absent' | 'aligned' | 'drifted';

export interface WayfinderFactDrift {
  readonly artifacts?: readonly WayfinderArtifactKind[] | undefined;
  readonly reasons?: readonly WayfinderStaleReason[] | undefined;
  readonly status: WayfinderFactDriftStatus;
}

export interface WayfinderFact<TValue> {
  readonly artifactStatus: WayfinderArtifactStatus;
  readonly category: WayfinderFactCategory;
  readonly derivedFrom: WayfinderContractRef | null;
  readonly drift: WayfinderFactDrift;
  readonly source: WayfinderArtifactSource;
  readonly value: TValue;
}

export type WayfinderFactInput<TValue> = Omit<
  WayfinderFact<TValue>,
  'drift'
> & {
  readonly drift?: WayfinderFactDrift | undefined;
};

export const wayfinderDriftFromArtifactStatus = (
  artifactStatus: WayfinderArtifactStatus
): WayfinderFactDrift => {
  switch (artifactStatus.status) {
    case 'fresh': {
      return { status: 'aligned' };
    }
    case 'missing': {
      return {
        artifacts: artifactStatus.artifacts,
        status: 'absent',
      };
    }
    case 'schema-version-drift':
    case 'stale': {
      return {
        ...(artifactStatus.status === 'stale'
          ? { reasons: artifactStatus.reasons }
          : {}),
        status: 'drifted',
      };
    }
    default: {
      artifactStatus satisfies never;
      return { status: 'drifted' };
    }
  }
};

export const wayfinderDriftFromFreshness = (
  artifactStatus: WayfinderArtifactStatus
): WayfinderFactDrift => wayfinderDriftFromArtifactStatus(artifactStatus);

export const wayfinderFact = <TValue>(
  fact: WayfinderFactInput<TValue>
): WayfinderFact<TValue> => ({
  ...fact,
  drift: fact.drift ?? wayfinderDriftFromArtifactStatus(fact.artifactStatus),
});
