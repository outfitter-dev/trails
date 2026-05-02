import type { ActivationSourceKind, Topo } from '@ontrails/core';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'unmaterialized-activation-source';
const TOPO_FILE = '<topo>';

const MATERIALIZED_SOURCE_KINDS = new Set<ActivationSourceKind>([
  'schedule',
  'signal',
  'webhook',
]);

const PENDING_SOURCE_KINDS = new Set<ActivationSourceKind>();

interface SourceConsumers {
  readonly id: string;
  readonly kind: ActivationSourceKind;
  readonly key: string;
  readonly trailIds: readonly string[];
}

const sourceKey = (kind: ActivationSourceKind, id: string): string =>
  `${kind}:${id}`;

const sortedUnique = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].toSorted();

const collectSourceConsumers = (topo: Topo): readonly SourceConsumers[] => {
  const consumersBySource = new Map<
    string,
    {
      readonly id: string;
      readonly kind: ActivationSourceKind;
      readonly trailIds: Set<string>;
    }
  >();

  for (const trail of topo.list()) {
    for (const activation of trail.activationSources) {
      const key = sourceKey(activation.source.kind, activation.source.id);
      const current =
        consumersBySource.get(key) ??
        ({
          id: activation.source.id,
          kind: activation.source.kind,
          trailIds: new Set<string>(),
        } as const);
      current.trailIds.add(trail.id);
      consumersBySource.set(key, current);
    }
  }

  return [...consumersBySource.entries()]
    .map(([key, source]) => ({
      id: source.id,
      key,
      kind: source.kind,
      trailIds: sortedUnique(source.trailIds),
    }))
    .toSorted((a, b) => a.key.localeCompare(b.key));
};

const isUnmaterialized = (kind: ActivationSourceKind): boolean =>
  PENDING_SOURCE_KINDS.has(kind) && !MATERIALIZED_SOURCE_KINDS.has(kind);

const buildDiagnostic = (source: SourceConsumers): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Activation source "${source.id}" of kind "${source.kind}" activates trail${source.trailIds.length === 1 ? '' : 's'} ${source.trailIds.map((id) => `"${id}"`).join(', ')} but no built-in materializer is available in this stack. Add the materializer before relying on runtime delivery, or defer the source declaration until the materializer lands.`,
  rule: RULE_NAME,
  severity: 'warn',
});

export const unmaterializedActivationSource: TopoAwareWardenRule = {
  checkTopo: (topo) =>
    collectSourceConsumers(topo)
      .filter((source) => isUnmaterialized(source.kind))
      .map((source) => buildDiagnostic(source)),
  description:
    'Warn when declared activation sources do not have an available runtime materializer.',
  name: RULE_NAME,
  severity: 'warn',
};
