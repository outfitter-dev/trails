import type {
  ActivationEntry,
  ActivationSource,
  AnyTrail,
  Topo,
} from '@ontrails/core';

export interface ActivationChainReport {
  readonly consumer: string;
  readonly producer: string;
  readonly signal: string;
}

export interface ActivationSourceReport extends Readonly<
  Record<string, unknown>
> {
  readonly cron?: string | undefined;
  readonly hasParse?: true | undefined;
  readonly hasPayloadSchema?: true | undefined;
  readonly id: string;
  readonly input?: unknown;
  readonly kind: string;
  readonly key: string;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly timezone?: string | undefined;
}

export interface ActivationEdgeReport extends Readonly<
  Record<string, unknown>
> {
  readonly hasWhere: boolean;
  readonly sourceId: string;
  readonly sourceKey: string;
  readonly sourceKind: string;
  readonly trailId: string;
  readonly where?: { readonly predicate: true } | undefined;
}

export interface SignalActivationRelations {
  readonly consumers: readonly string[];
  readonly producers: readonly string[];
}

export interface TrailActivationReport {
  readonly activatedBy: readonly string[];
  readonly activates: readonly string[];
  readonly chains: readonly ActivationChainReport[];
  readonly edges: readonly ActivationEdgeReport[];
  readonly fires: readonly string[];
  readonly on: readonly string[];
  readonly sources: readonly ActivationSourceReport[];
}

export interface ActivationOverviewReport {
  readonly chainCount: number;
  readonly chains: readonly ActivationChainReport[];
  readonly edgeCount: number;
  readonly edges: readonly ActivationEdgeReport[];
  readonly signalIds: readonly string[];
  readonly sourceCount: number;
  readonly sourceKeys: readonly string[];
  readonly trailIds: readonly string[];
}

export interface ActivationGraphReport {
  readonly overview: ActivationOverviewReport;
  readonly signals: ReadonlyMap<string, SignalActivationRelations>;
  readonly sources: ReadonlyMap<string, ActivationSourceReport>;
  readonly trails: ReadonlyMap<string, TrailActivationReport>;
}

interface MutableSignalRelations {
  readonly consumers: Set<string>;
  readonly producers: Set<string>;
}

interface MutableTrailActivation {
  readonly activatedBy: Set<string>;
  readonly activates: Set<string>;
  readonly chains: ActivationChainReport[];
  readonly fires: readonly string[];
  readonly on: readonly string[];
}

const canonicalLeaf = (value: unknown): unknown => {
  switch (typeof value) {
    case 'bigint': {
      return value.toString();
    }
    case 'function': {
      return `[Function:${value.name || 'anonymous'}]`;
    }
    case 'symbol': {
      return `[Symbol:${value.description ?? ''}]`;
    }
    case 'undefined': {
      return '[Undefined]';
    }
    default: {
      return value;
    }
  }
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      const next = (value as Record<string, unknown>)[key];
      sorted[key] = next === undefined ? '[Undefined]' : canonicalize(next);
    }
    return sorted;
  }
  return canonicalLeaf(value);
};

const sortKeys = <T extends Record<string, unknown>>(value: T): T => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    sorted[key] = value[key];
  }
  return sorted as T;
};

const compareChains = (
  a: ActivationChainReport,
  b: ActivationChainReport
): number =>
  a.producer.localeCompare(b.producer) ||
  a.signal.localeCompare(b.signal) ||
  a.consumer.localeCompare(b.consumer);

const sortedUnique = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].toSorted();

const activationSourceKey = (source: Pick<ActivationSource, 'id' | 'kind'>) =>
  `${source.kind}:${source.id}`;

const projectActivationSource = (
  source: ActivationSource
): ActivationSourceReport => {
  const record: Record<string, unknown> = {
    id: source.id,
    key: activationSourceKey(source),
    kind: source.kind,
  };

  if (source.cron !== undefined) {
    record['cron'] = source.cron;
  }
  if (Object.hasOwn(source, 'input')) {
    record['input'] = canonicalize(source.input);
  }
  if (source.meta !== undefined) {
    record['meta'] = canonicalize(source.meta);
  }
  if (source.parse !== undefined) {
    record['hasParse'] = true;
  }
  if (source.payload !== undefined) {
    record['hasPayloadSchema'] = true;
  }
  if (source.timezone !== undefined) {
    record['timezone'] = source.timezone;
  }

  return sortKeys(record) as ActivationSourceReport;
};

const projectActivationEdge = (
  trailId: string,
  activation: ActivationEntry
): ActivationEdgeReport => {
  const sourceKey = activationSourceKey(activation.source);
  const edge: Record<string, unknown> = {
    hasWhere: activation.where !== undefined,
    sourceId: activation.source.id,
    sourceKey,
    sourceKind: activation.source.kind,
    trailId,
  };

  if (activation.meta !== undefined) {
    edge['meta'] = canonicalize(activation.meta);
  }
  if (activation.where !== undefined) {
    edge['where'] = { predicate: true };
  }

  return sortKeys(edge) as ActivationEdgeReport;
};

const collectActivationSourceCatalog = (
  trails: readonly AnyTrail[]
): readonly ActivationSourceReport[] => {
  const sources = new Map<string, ActivationSourceReport>();
  for (const trail of trails) {
    for (const activation of trail.activationSources) {
      const projected = projectActivationSource(activation.source);
      sources.set(projected.key, projected);
    }
  }
  return [...sources.values()].toSorted((a, b) => a.key.localeCompare(b.key));
};

const collectActivationEdges = (
  trails: readonly AnyTrail[]
): readonly ActivationEdgeReport[] => {
  const edges = new Map<string, ActivationEdgeReport>();
  for (const trail of trails) {
    for (const activation of trail.activationSources) {
      const edge = projectActivationEdge(trail.id, activation);
      const key = `${edge.sourceKey}\0${edge.trailId}`;
      const previous = edges.get(key);
      edges.set(
        key,
        previous === undefined || (!previous.hasWhere && edge.hasWhere)
          ? edge
          : previous
      );
    }
  }

  return [...edges.values()].toSorted(
    (a, b) =>
      a.sourceKey.localeCompare(b.sourceKey) ||
      a.trailId.localeCompare(b.trailId)
  );
};

const getSignalRelations = (
  relations: Map<string, MutableSignalRelations>,
  signalId: string
): MutableSignalRelations => {
  const existing = relations.get(signalId);
  if (existing !== undefined) {
    return existing;
  }

  const created = {
    consumers: new Set<string>(),
    producers: new Set<string>(),
  };
  relations.set(signalId, created);
  return created;
};

const getTrailActivation = (
  trails: Map<string, MutableTrailActivation>,
  trail: AnyTrail
): MutableTrailActivation => {
  const existing = trails.get(trail.id);
  if (existing !== undefined) {
    return existing;
  }

  const created = {
    activatedBy: new Set<string>(),
    activates: new Set<string>(),
    chains: [],
    fires: sortedUnique(trail.fires),
    on: sortedUnique(trail.on),
  };
  trails.set(trail.id, created);
  return created;
};

export const deriveDeclaredTrailActivation = (
  trail: AnyTrail
): TrailActivationReport => {
  const sources = collectActivationSourceCatalog([trail]);
  return {
    activatedBy: [],
    activates: [],
    chains: [],
    edges: collectActivationEdges([trail]),
    fires: sortedUnique(trail.fires),
    on: sortedUnique(trail.on),
    sources,
  };
};

export const deriveSignalActivationRelations = (
  app: Topo,
  signalId: string
): SignalActivationRelations => {
  const consumers: string[] = [];
  const producers: string[] = [];

  for (const trail of app.list()) {
    if (trail.fires.includes(signalId)) {
      producers.push(trail.id);
    }
    if (trail.on.includes(signalId)) {
      consumers.push(trail.id);
    }
  }

  return {
    consumers: sortedUnique(consumers),
    producers: sortedUnique(producers),
  };
};

export const deriveActivationGraph = (app: Topo): ActivationGraphReport => {
  const signalRelations = new Map<string, MutableSignalRelations>();
  const trailActivations = new Map<string, MutableTrailActivation>();
  const trails = app.list();
  const sources = collectActivationSourceCatalog(trails);
  const edges = collectActivationEdges(trails);

  for (const signal of app.listSignals()) {
    getSignalRelations(signalRelations, signal.id);
  }

  for (const trail of trails) {
    const trailActivation = getTrailActivation(trailActivations, trail);
    for (const signalId of trailActivation.fires) {
      getSignalRelations(signalRelations, signalId).producers.add(trail.id);
    }
    for (const signalId of trailActivation.on) {
      getSignalRelations(signalRelations, signalId).consumers.add(trail.id);
    }
  }

  const chains: ActivationChainReport[] = [];
  for (const [signal, related] of signalRelations) {
    for (const producer of related.producers) {
      const producerActivation = trailActivations.get(producer);
      for (const consumer of related.consumers) {
        const chain = { consumer, producer, signal };
        chains.push(chain);
        producerActivation?.activates.add(consumer);
        producerActivation?.chains.push(chain);
        const consumerActivation = trailActivations.get(consumer);
        consumerActivation?.activatedBy.add(producer);
        if (consumerActivation !== producerActivation) {
          consumerActivation?.chains.push(chain);
        }
      }
    }
  }

  chains.sort(compareChains);
  const activeTrailIds = sortedUnique([
    ...[...trailActivations.entries()].flatMap(([trailId, trail]) =>
      trail.fires.length > 0 || trail.on.length > 0
        ? [trailId, ...trail.activatedBy, ...trail.activates]
        : []
    ),
    ...edges.map((edge) => edge.trailId),
  ]);

  return {
    overview: {
      chainCount: chains.length,
      chains,
      edgeCount: edges.length,
      edges,
      signalIds: [...signalRelations.keys()].toSorted(),
      sourceCount: sources.length,
      sourceKeys: sources.map((source) => source.key),
      trailIds: activeTrailIds,
    },
    signals: new Map(
      [...signalRelations.entries()].map(([id, relations]) => [
        id,
        {
          consumers: sortedUnique(relations.consumers),
          producers: sortedUnique(relations.producers),
        },
      ])
    ),
    sources: new Map(sources.map((source) => [source.key, source])),
    trails: new Map(
      [...trailActivations.entries()].map(([id, activation]) => [
        id,
        {
          activatedBy: sortedUnique(activation.activatedBy),
          activates: sortedUnique(activation.activates),
          chains: activation.chains.toSorted(compareChains),
          edges: edges.filter((edge) => edge.trailId === id),
          fires: activation.fires,
          on: activation.on,
          sources: sources.filter((source) =>
            edges.some(
              (edge) => edge.trailId === id && edge.sourceKey === source.key
            )
          ),
        },
      ])
    ),
  };
};
