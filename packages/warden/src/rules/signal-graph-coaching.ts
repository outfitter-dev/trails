import type { Topo } from '@ontrails/core';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'signal-graph-coaching';
const TOPO_FILE = '<topo>';

interface SignalRelations {
  readonly consumers: readonly string[];
  readonly producerResources: readonly string[];
  readonly producerTrails: readonly string[];
}

const sortedUnique = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].toSorted();

const collectSignalIds = (topo: Topo): readonly string[] =>
  sortedUnique(topo.listSignals().map((signal) => signal.id));

const collectProducerTrails = (
  topo: Topo
): ReadonlyMap<string, readonly string[]> => {
  const producersBySignal = new Map<string, Set<string>>();

  for (const signal of topo.listSignals()) {
    if ((signal.from?.length ?? 0) === 0) {
      continue;
    }
    const producers = producersBySignal.get(signal.id) ?? new Set<string>();
    for (const producerTrailId of signal.from ?? []) {
      producers.add(producerTrailId);
    }
    producersBySignal.set(signal.id, producers);
  }

  for (const trail of topo.list()) {
    for (const signalId of trail.fires) {
      const producers = producersBySignal.get(signalId) ?? new Set<string>();
      producers.add(trail.id);
      producersBySignal.set(signalId, producers);
    }
  }

  return new Map(
    [...producersBySignal.entries()].map(([signalId, producers]) => [
      signalId,
      sortedUnique(producers),
    ])
  );
};

const collectProducerResources = (
  topo: Topo
): ReadonlyMap<string, readonly string[]> => {
  const resourcesBySignal = new Map<string, Set<string>>();

  for (const resource of topo.listResources()) {
    for (const signal of resource.signals ?? []) {
      const resources = resourcesBySignal.get(signal.id) ?? new Set<string>();
      resources.add(resource.id);
      resourcesBySignal.set(signal.id, resources);
    }
  }

  return new Map(
    [...resourcesBySignal.entries()].map(([signalId, resources]) => [
      signalId,
      sortedUnique(resources),
    ])
  );
};

const collectConsumers = (
  topo: Topo
): ReadonlyMap<string, readonly string[]> => {
  const consumersBySignal = new Map<string, Set<string>>();

  for (const trail of topo.list()) {
    for (const activation of trail.activationSources) {
      if (activation.source.kind !== 'signal') {
        continue;
      }
      const consumers =
        consumersBySignal.get(activation.source.id) ?? new Set<string>();
      consumers.add(trail.id);
      consumersBySignal.set(activation.source.id, consumers);
    }
  }

  return new Map(
    [...consumersBySignal.entries()].map(([signalId, consumers]) => [
      signalId,
      sortedUnique(consumers),
    ])
  );
};

const collectRelations = (topo: Topo): ReadonlyMap<string, SignalRelations> => {
  const producerTrails = collectProducerTrails(topo);
  const producerResources = collectProducerResources(topo);
  const consumers = collectConsumers(topo);

  return new Map(
    collectSignalIds(topo).map((signalId) => [
      signalId,
      {
        consumers: consumers.get(signalId) ?? [],
        producerResources: producerResources.get(signalId) ?? [],
        producerTrails: producerTrails.get(signalId) ?? [],
      },
    ])
  );
};

const quoteList = (values: readonly string[]): string =>
  values.map((value) => `"${value}"`).join(', ');

const formatProducerClause = ({
  producerResources,
  producerTrails,
}: SignalRelations): string => {
  const clauses: string[] = [];
  if (producerTrails.length > 0) {
    clauses.push(
      `producer trail${producerTrails.length === 1 ? '' : 's'} ${quoteList(producerTrails)}`
    );
  }
  if (producerResources.length > 0) {
    clauses.push(
      `producer resource${producerResources.length === 1 ? '' : 's'} ${quoteList(producerResources)}`
    );
  }
  return clauses.join(' and ');
};

const buildDeadSignalDiagnostic = (signalId: string): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Signal "${signalId}" is declared in the topo but has no producer trails, producer resources, or consumer trails. Add fires:/on: edges, attach producer metadata, or remove the unused signal contract.`,
  rule: RULE_NAME,
  severity: 'warn',
});

const buildProducedWithoutConsumerDiagnostic = (
  signalId: string,
  relations: SignalRelations
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Signal "${signalId}" is produced by ${formatProducerClause(relations)} but has no consumer trails. Add an on: consumer if the signal is meant to drive reactive work, or remove the unused fires:/producer declaration.`,
  rule: RULE_NAME,
  severity: 'warn',
});

const hasProducer = ({
  producerResources,
  producerTrails,
}: SignalRelations): boolean =>
  producerResources.length > 0 || producerTrails.length > 0;

const hasConsumer = ({ consumers }: SignalRelations): boolean =>
  consumers.length > 0;

const buildDiagnostics = (
  relationsBySignal: ReadonlyMap<string, SignalRelations>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];

  for (const [signalId, relations] of relationsBySignal) {
    if (!hasProducer(relations) && !hasConsumer(relations)) {
      diagnostics.push(buildDeadSignalDiagnostic(signalId));
      continue;
    }

    if (hasProducer(relations) && !hasConsumer(relations)) {
      diagnostics.push(
        buildProducedWithoutConsumerDiagnostic(signalId, relations)
      );
    }
  }

  return diagnostics;
};

export const signalGraphCoaching: TopoAwareWardenRule = {
  checkTopo: (topo) => buildDiagnostics(collectRelations(topo)),
  description:
    'Warn when typed signal contracts are declared or produced without reactive consumers.',
  name: RULE_NAME,
  severity: 'warn',
};
