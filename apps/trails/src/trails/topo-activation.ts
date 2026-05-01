import type { AnyTrail, Topo } from '@ontrails/core';

export interface ActivationChainReport {
  readonly consumer: string;
  readonly producer: string;
  readonly signal: string;
}

export interface SignalActivationRelations {
  readonly consumers: readonly string[];
  readonly producers: readonly string[];
}

export interface TrailActivationReport {
  readonly activatedBy: readonly string[];
  readonly activates: readonly string[];
  readonly chains: readonly ActivationChainReport[];
  readonly fires: readonly string[];
  readonly on: readonly string[];
}

export interface ActivationOverviewReport {
  readonly chainCount: number;
  readonly chains: readonly ActivationChainReport[];
  readonly signalIds: readonly string[];
  readonly trailIds: readonly string[];
}

export interface ActivationGraphReport {
  readonly overview: ActivationOverviewReport;
  readonly signals: ReadonlyMap<string, SignalActivationRelations>;
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

const compareChains = (
  a: ActivationChainReport,
  b: ActivationChainReport
): number =>
  a.producer.localeCompare(b.producer) ||
  a.signal.localeCompare(b.signal) ||
  a.consumer.localeCompare(b.consumer);

const sortedUnique = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].toSorted();

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
): TrailActivationReport => ({
  activatedBy: [],
  activates: [],
  chains: [],
  fires: sortedUnique(trail.fires),
  on: sortedUnique(trail.on),
});

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

  for (const signal of app.listSignals()) {
    getSignalRelations(signalRelations, signal.id);
  }

  for (const trail of app.list()) {
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
  const activeTrailIds = sortedUnique(
    [...trailActivations.entries()].flatMap(([trailId, trail]) =>
      trail.fires.length > 0 || trail.on.length > 0
        ? [trailId, ...trail.activatedBy, ...trail.activates]
        : []
    )
  );

  return {
    overview: {
      chainCount: chains.length,
      chains,
      signalIds: [...signalRelations.keys()].toSorted(),
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
    trails: new Map(
      [...trailActivations.entries()].map(([id, activation]) => [
        id,
        {
          activatedBy: sortedUnique(activation.activatedBy),
          activates: sortedUnique(activation.activates),
          chains: activation.chains.toSorted(compareChains),
          fires: activation.fires,
          on: activation.on,
        },
      ])
    ),
  };
};
