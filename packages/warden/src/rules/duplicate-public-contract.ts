import { deriveTopoGraph } from '@ontrails/topographer';
import type { TopoGraph, TopoGraphEntry } from '@ontrails/topographer';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'duplicate-public-contract';
const TOPO_FILE = '<topo>';

const resolveGraph = (
  topo: Parameters<TopoAwareWardenRule['checkTopo']>[0],
  graph: TopoGraph | undefined
): TopoGraph => graph ?? deriveTopoGraph(topo);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)])
    );
  }
  return value;
};

const contractFingerprint = (entry: TopoGraphEntry): string =>
  JSON.stringify(
    canonicalize({
      composes: entry.composes,
      detours: entry.detours,
      dryRunCapable: entry.dryRunCapable,
      entities: entry.entities,
      fires: entry.fires,
      idempotent: entry.idempotent,
      input: entry.input,
      intent: entry.intent,
      meta: entry.meta,
      on: entry.on,
      output: entry.output,
      permit: entry.permit,
      resources: entry.resources,
    })
  );

const isCandidate = (entry: TopoGraphEntry): boolean =>
  entry.kind === 'trail' &&
  !entry.id.startsWith('warden.rule.') &&
  entry.deprecated !== true &&
  entry.meta?.['internal'] !== true &&
  entry.input !== undefined &&
  entry.output !== undefined &&
  Boolean(entry.cli || entry.surfaces.length > 0);

const renderTrailIds = (trailIds: readonly string[]): string =>
  trailIds
    .toSorted((left, right) => left.localeCompare(right))
    .map((trailId) => `"${trailId}"`)
    .join(', ');

const buildDiagnostic = (trailIds: readonly string[]): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Likely duplicate public trail contracts ${renderTrailIds(trailIds)} share the same input, output, intent, permits, resources, entities, composes, signals, and detours. Keep one contract with aliases/input mappings, compose a distinct wrapper, or document why these public contracts are separate.`,
  rule: RULE_NAME,
  severity: 'warn',
});

export const duplicatePublicContract: TopoAwareWardenRule = {
  checkTopo(topo, context) {
    const graph = resolveGraph(topo, context?.graph);
    const groups = new Map<string, string[]>();

    for (const entry of graph.entries) {
      if (!isCandidate(entry)) {
        continue;
      }
      const key = contractFingerprint(entry);
      groups.set(key, [...(groups.get(key) ?? []), entry.id]);
    }

    return [...groups.values()]
      .filter((trailIds) => trailIds.length > 1)
      .map(buildDiagnostic);
  },
  description:
    'Warn when public surface trails expose the same normalized contract facts.',
  name: RULE_NAME,
  severity: 'warn',
};
