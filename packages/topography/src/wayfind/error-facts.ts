import {
  errorClasses,
  projectErrorClassSurface,
  surfaceNames,
} from '@ontrails/core';
import type {
  ErrorCategory,
  ErrorClassRegistryEntry,
  ErrorClassSurfaceProjection,
  SurfaceName,
} from '@ontrails/core';
import type {
  TopoGraph,
  TopoGraphEntry,
  TopoGraphVersionEntry,
} from '../types.js';

export type TrailErrorFactKind =
  | 'documented'
  | 'handled'
  | 'inferred'
  | 'observed';

export type TrailErrorFactsCompleteness =
  | {
      readonly reason: 'authored-facts-exhausted';
      readonly status: 'complete';
    }
  | {
      readonly reason: 'inferred-facts-supplied' | 'observed-facts-supplied';
      readonly status: 'partial';
    }
  | {
      readonly reason: 'no-exhaustive-emitted-error-contract' | 'not-evaluated';
      readonly status: 'unknown';
    };

export interface TrailErrorTaxonomyProjection {
  readonly category?: ErrorCategory | undefined;
  readonly dynamicCategory?:
    | {
        readonly inheritsCategoryFrom: 'wrapped-error';
      }
    | undefined;
  readonly known: boolean;
  readonly name: string;
  readonly retryable?: boolean | undefined;
  readonly surfaces: readonly ErrorClassSurfaceProjection[];
}

export type TrailErrorFactProvenance =
  | {
      readonly exampleName: string;
      readonly source: 'trail.examples' | 'trail.versions.examples';
      readonly trailId: string;
      readonly version?: number | undefined;
    }
  | {
      readonly detourIndex: number;
      readonly source: 'trail.detours' | 'trail.versions.detours';
      readonly trailId: string;
      readonly version?: number | undefined;
    }
  | {
      readonly detail?: string | undefined;
      readonly source: 'static-inference';
      readonly trailId: string;
      readonly version?: number | undefined;
    }
  | {
      readonly detail?: string | undefined;
      readonly source: 'runtime-observation';
      readonly trailId: string;
      readonly version?: number | undefined;
    };

export interface TrailErrorFact {
  readonly completeness: TrailErrorFactsCompleteness;
  readonly kind: TrailErrorFactKind;
  readonly provenance: TrailErrorFactProvenance;
  readonly taxonomy: TrailErrorTaxonomyProjection;
}

export interface TrailErrorFacts {
  readonly completeness: {
    readonly emitted: TrailErrorFactsCompleteness;
    readonly handled: TrailErrorFactsCompleteness;
    readonly documented: TrailErrorFactsCompleteness;
    readonly inferred: TrailErrorFactsCompleteness;
    readonly observed: TrailErrorFactsCompleteness;
  };
  readonly facts: readonly TrailErrorFact[];
  readonly trailId: string;
}

export interface TrailErrorEvidenceInput {
  readonly detail?: string | undefined;
  readonly errorName: string;
  readonly trailId: string;
  readonly version?: number | undefined;
}

export interface TrailErrorFactsOptions {
  readonly inferred?: readonly TrailErrorEvidenceInput[] | undefined;
  readonly observed?: readonly TrailErrorEvidenceInput[] | undefined;
  readonly surfaces?: readonly SurfaceName[] | undefined;
}

const errorClassByName: ReadonlyMap<string, ErrorClassRegistryEntry> = new Map(
  errorClasses.map((entry) => [entry.name, entry])
);

const taxonomyProjection = (
  errorName: string,
  surfaces: readonly SurfaceName[]
): TrailErrorTaxonomyProjection => {
  const registryEntry = errorClassByName.get(errorName);
  if (registryEntry === undefined) {
    return {
      known: false,
      name: errorName,
      surfaces: [],
    };
  }

  if (registryEntry.category === 'dynamic') {
    return {
      dynamicCategory: {
        inheritsCategoryFrom: registryEntry.inheritsCategoryFrom,
      },
      known: true,
      name: registryEntry.name,
      retryable: registryEntry.retryable,
      surfaces: [],
    };
  }

  return {
    category: registryEntry.category,
    known: true,
    name: registryEntry.name,
    retryable: registryEntry.retryable,
    surfaces: surfaces.flatMap((surface) => {
      const projected = projectErrorClassSurface(surface, errorName);
      return projected === undefined ? [] : [projected];
    }),
  };
};

const authoredCompleteness: TrailErrorFactsCompleteness = {
  reason: 'authored-facts-exhausted',
  status: 'complete',
};

const emittedCompleteness: TrailErrorFactsCompleteness = {
  reason: 'no-exhaustive-emitted-error-contract',
  status: 'unknown',
};

const notEvaluatedCompleteness: TrailErrorFactsCompleteness = {
  reason: 'not-evaluated',
  status: 'unknown',
};

const inferredCompleteness: TrailErrorFactsCompleteness = {
  reason: 'inferred-facts-supplied',
  status: 'partial',
};

const observedCompleteness: TrailErrorFactsCompleteness = {
  reason: 'observed-facts-supplied',
  status: 'partial',
};

const documentedFacts = (
  entry: TopoGraphEntry,
  surfaces: readonly SurfaceName[]
): TrailErrorFact[] =>
  (entry.examples ?? []).flatMap((example): TrailErrorFact[] => {
    if (example.kind !== 'error' || example.error === undefined) {
      return [];
    }
    return [
      {
        completeness: authoredCompleteness,
        kind: 'documented',
        provenance: {
          exampleName: example.name,
          source: 'trail.examples',
          trailId: entry.id,
        },
        taxonomy: taxonomyProjection(example.error, surfaces),
      },
    ];
  });

const handledFacts = (
  entry: TopoGraphEntry,
  surfaces: readonly SurfaceName[]
): TrailErrorFact[] =>
  (entry.detours ?? []).map(
    (detour, detourIndex): TrailErrorFact => ({
      completeness: authoredCompleteness,
      kind: 'handled',
      provenance: {
        detourIndex,
        source: 'trail.detours',
        trailId: entry.id,
      },
      taxonomy: taxonomyProjection(detour.on, surfaces),
    })
  );

const versionDocumentedFacts = (
  trailId: string,
  version: number,
  entry: TopoGraphVersionEntry,
  surfaces: readonly SurfaceName[]
): TrailErrorFact[] =>
  (entry.examples ?? []).flatMap((example): TrailErrorFact[] => {
    if (example.kind !== 'error' || example.error === undefined) {
      return [];
    }
    return [
      {
        completeness: authoredCompleteness,
        kind: 'documented',
        provenance: {
          exampleName: example.name,
          source: 'trail.versions.examples',
          trailId,
          version,
        },
        taxonomy: taxonomyProjection(example.error, surfaces),
      },
    ];
  });

const versionHandledFacts = (
  trailId: string,
  version: number,
  entry: TopoGraphVersionEntry,
  surfaces: readonly SurfaceName[]
): TrailErrorFact[] =>
  (entry.detours ?? []).map(
    (detour, detourIndex): TrailErrorFact => ({
      completeness: authoredCompleteness,
      kind: 'handled',
      provenance: {
        detourIndex,
        source: 'trail.versions.detours',
        trailId,
        version,
      },
      taxonomy: taxonomyProjection(detour.on, surfaces),
    })
  );

const versionFacts = (
  entry: TopoGraphEntry,
  surfaces: readonly SurfaceName[]
): TrailErrorFact[] =>
  Object.entries(entry.versions ?? {}).flatMap(([versionKey, versionEntry]) => {
    const version = Number.parseInt(versionKey, 10);
    if (!Number.isFinite(version)) {
      return [];
    }
    return [
      ...versionDocumentedFacts(entry.id, version, versionEntry, surfaces),
      ...versionHandledFacts(entry.id, version, versionEntry, surfaces),
    ];
  });

const inputFact = (
  input: TrailErrorEvidenceInput,
  kind: 'inferred' | 'observed',
  surfaces: readonly SurfaceName[]
): TrailErrorFact => ({
  completeness:
    kind === 'inferred' ? inferredCompleteness : observedCompleteness,
  kind,
  provenance: {
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    source: kind === 'inferred' ? 'static-inference' : 'runtime-observation',
    trailId: input.trailId,
    ...(input.version === undefined ? {} : { version: input.version }),
  },
  taxonomy: taxonomyProjection(input.errorName, surfaces),
});

const byTrail = (
  inputs: readonly TrailErrorEvidenceInput[] | undefined
): ReadonlyMap<string, readonly TrailErrorEvidenceInput[]> => {
  const map = new Map<string, TrailErrorEvidenceInput[]>();
  for (const input of inputs ?? []) {
    const existing = map.get(input.trailId) ?? [];
    existing.push(input);
    map.set(input.trailId, existing);
  }
  return map;
};

const sortFacts = (
  facts: readonly TrailErrorFact[]
): readonly TrailErrorFact[] =>
  [...facts].toSorted((left, right) => {
    const leftVersion = left.provenance.version ?? 0;
    const rightVersion = right.provenance.version ?? 0;
    return (
      leftVersion - rightVersion ||
      left.kind.localeCompare(right.kind) ||
      left.taxonomy.name.localeCompare(right.taxonomy.name)
    );
  });

export const deriveTrailErrorFacts = (
  topoGraph: TopoGraph,
  options: TrailErrorFactsOptions = {}
): readonly TrailErrorFacts[] => {
  const surfaces = options.surfaces ?? surfaceNames;
  const inferredByTrail = byTrail(options.inferred);
  const observedByTrail = byTrail(options.observed);

  return topoGraph.entries
    .filter(
      (entry): entry is TopoGraphEntry & { readonly kind: 'trail' } =>
        entry.kind === 'trail'
    )
    .map((entry): TrailErrorFacts => {
      const inferredInputs = inferredByTrail.get(entry.id) ?? [];
      const observedInputs = observedByTrail.get(entry.id) ?? [];
      const facts = sortFacts([
        ...documentedFacts(entry, surfaces),
        ...handledFacts(entry, surfaces),
        ...versionFacts(entry, surfaces),
        ...inferredInputs.map((input) =>
          inputFact(input, 'inferred', surfaces)
        ),
        ...observedInputs.map((input) =>
          inputFact(input, 'observed', surfaces)
        ),
      ]);

      return {
        completeness: {
          documented: authoredCompleteness,
          emitted: emittedCompleteness,
          handled: authoredCompleteness,
          inferred:
            inferredInputs.length > 0
              ? inferredCompleteness
              : notEvaluatedCompleteness,
          observed:
            observedInputs.length > 0
              ? observedCompleteness
              : notEvaluatedCompleteness,
        },
        facts,
        trailId: entry.id,
      };
    })
    .toSorted((left, right) => left.trailId.localeCompare(right.trailId));
};
