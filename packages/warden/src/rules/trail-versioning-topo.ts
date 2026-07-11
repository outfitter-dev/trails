import { deriveTopoGraph } from '@ontrails/topography';
import type {
  TopoGraph,
  TopoGraphEntry,
  TopoGraphForceEntry,
  TopoGraphVersionEntry,
} from '@ontrails/topography';
import type { Topo } from '@ontrails/core';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const TOPO_FILE = '<topo>';

const isArchived = (entry: TopoGraphVersionEntry): boolean =>
  entry.status?.state === 'archived';

const isDeprecatedWithoutGuidance = (entry: TopoGraphVersionEntry): boolean =>
  entry.status?.state === 'deprecated' &&
  entry.status.successor === undefined &&
  entry.status.note === undefined &&
  (entry.status.migration === undefined || entry.status.migration.length === 0);

const versionNumbersFor = (entry: TopoGraphEntry): readonly number[] => [
  ...(entry.version === undefined ? [] : [entry.version]),
  ...Object.keys(entry.versions ?? {}).map(Number),
];

const versionEntryName = (trailId: string, version: string): string =>
  `${trailId}@${version}`;

const topoDiagnostic = (
  rule: string,
  severity: WardenDiagnostic['severity'],
  message: string
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message,
  rule,
  severity,
});

const trailEntries = (graph: TopoGraph): readonly TopoGraphEntry[] =>
  graph.entries.filter((entry) => entry.kind === 'trail');

const graphFor = (
  topo: Topo,
  context: Parameters<TopoAwareWardenRule['checkTopo']>[1]
): TopoGraph => context?.graph ?? deriveTopoGraph(topo);

const forceKey = (force: TopoGraphForceEntry): string =>
  JSON.stringify([
    force.kind,
    force.id,
    force.change,
    force.detail,
    force.reason,
    force.severity,
    force.source,
  ]);

const pendingForceDiagnostic = (force: TopoGraphForceEntry): WardenDiagnostic =>
  topoDiagnostic(
    'pending-force',
    'warn',
    `Trail "${force.id}" has a pending forced topo break (${force.change}: ${force.detail}). Resolve or document the force event before release.`
  );

export const deprecationWithoutGuidance: TopoAwareWardenRule = {
  checkTopo(topo, context) {
    return trailEntries(graphFor(topo, context)).flatMap((entry) =>
      Object.entries(entry.versions ?? {}).flatMap(([version, historical]) =>
        isDeprecatedWithoutGuidance(historical)
          ? [
              topoDiagnostic(
                'deprecation-without-guidance',
                'error',
                `Trail "${versionEntryName(entry.id, version)}" is deprecated without successor, migration, or note guidance. Add at least one guidance field to the version status.`
              ),
            ]
          : []
      )
    );
  },
  description:
    'Require deprecated trail version entries to carry successor, migration, or note guidance.',
  name: 'deprecation-without-guidance',
  severity: 'error',
};

export const versionGap: TopoAwareWardenRule = {
  checkTopo(topo, context) {
    const diagnostics: WardenDiagnostic[] = [];
    for (const entry of trailEntries(graphFor(topo, context))) {
      if (entry.version === undefined) {
        continue;
      }
      const historicalVersions = new Set(
        Object.keys(entry.versions ?? {}).map(Number)
      );
      if (historicalVersions.has(entry.version)) {
        diagnostics.push(
          topoDiagnostic(
            'version-gap',
            'error',
            `Trail "${entry.id}" declares current version ${entry.version} both as current and as a historical entry. Remove the duplicate historical entry.`
          )
        );
      }

      const versions = new Set(versionNumbersFor(entry));
      for (let version = 1; version <= entry.version; version += 1) {
        if (!versions.has(version)) {
          diagnostics.push(
            topoDiagnostic(
              'version-gap',
              'error',
              `Trail "${entry.id}" has a gap before current version ${entry.version}: missing version ${version}. Historical version coverage must be contiguous, including archived entries.`
            )
          );
        }
      }
    }
    return diagnostics;
  },
  description:
    'Require trail version coverage to stay contiguous from v1 through the current version.',
  name: 'version-gap',
  severity: 'error',
};

export const versionWithoutExamples: TopoAwareWardenRule = {
  checkTopo(topo, context) {
    return trailEntries(graphFor(topo, context)).flatMap((entry) =>
      Object.entries(entry.versions ?? {}).flatMap(([version, historical]) =>
        !isArchived(historical) && (historical.exampleCount ?? 0) === 0
          ? [
              topoDiagnostic(
                'version-without-examples',
                'warn',
                `Trail "${versionEntryName(entry.id, version)}" is a live historical version without examples. Add version-entry examples or archive the entry if it no longer participates in runtime negotiation.`
              ),
            ]
          : []
      )
    );
  },
  description:
    'Warn when live historical trail version entries do not include examples.',
  name: 'version-without-examples',
  severity: 'warn',
};

export const pendingForce: TopoAwareWardenRule = {
  checkTopo(topo, context) {
    const graph = graphFor(topo, context);
    const diagnostics = new Map<string, WardenDiagnostic>();
    for (const entry of trailEntries(graph)) {
      for (const force of entry.forces ?? []) {
        diagnostics.set(forceKey(force), pendingForceDiagnostic(force));
      }
    }
    for (const force of graph.forces ?? []) {
      diagnostics.set(forceKey(force), pendingForceDiagnostic(force));
    }
    return [...diagnostics.values()];
  },
  description:
    'Warn when graph-only force audit events remain attached to trail entries or the topo graph.',
  name: 'pending-force',
  severity: 'warn',
};
