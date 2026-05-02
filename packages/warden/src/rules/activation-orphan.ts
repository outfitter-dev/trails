import type { Topo } from '@ontrails/core';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'activation-orphan';
const TOPO_FILE = '<topo>';
const DRAFT_ID_PREFIX = ['_draft', '.'].join('');

const isDraftSourceId = (id: string): boolean => id.startsWith(DRAFT_ID_PREFIX);

const sortedUnique = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].toSorted();

const collectSignalProducerIds = (topo: Topo): ReadonlySet<string> => {
  const producerIds = new Set<string>();

  for (const signal of topo.listSignals()) {
    if ((signal.from?.length ?? 0) > 0) {
      producerIds.add(signal.id);
    }
  }

  for (const resource of topo.resources.values()) {
    for (const signal of resource.signals ?? []) {
      producerIds.add(signal.id);
    }
  }

  for (const trail of topo.list()) {
    for (const signalId of trail.fires) {
      producerIds.add(signalId);
    }
  }

  return producerIds;
};

const collectKnownSignalIds = (topo: Topo): ReadonlySet<string> =>
  new Set(topo.listSignals().map((signal) => signal.id));

const collectSignalConsumers = (
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

const buildDiagnostic = (
  signalId: string,
  consumerIds: readonly string[]
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Signal activation source "${signalId}" activates trail${consumerIds.length === 1 ? '' : 's'} ${consumerIds.map((id) => `"${id}"`).join(', ')} but has no producer declaration in the topo. Add a trail fires: declaration, add signal from: producer metadata, or remove the unused activation source.`,
  rule: RULE_NAME,
  severity: 'warn',
});

export const activationOrphan: TopoAwareWardenRule = {
  checkTopo: (topo) => {
    const knownSignalIds = collectKnownSignalIds(topo);
    const producerIds = collectSignalProducerIds(topo);
    const consumersBySignal = collectSignalConsumers(topo);

    return [...consumersBySignal.entries()]
      .filter(
        ([signalId]) =>
          !isDraftSourceId(signalId) &&
          knownSignalIds.has(signalId) &&
          !producerIds.has(signalId)
      )
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([signalId, consumerIds]) => buildDiagnostic(signalId, consumerIds));
  },
  description:
    'Warn when signal activation consumers reference sources with no producer declaration in the topo.',
  name: RULE_NAME,
  severity: 'warn',
};
