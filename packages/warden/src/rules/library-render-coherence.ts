import { deriveTopoGraph } from '@ontrails/topography';
import type { TopoGraph, TopoGraphLibraryDerived } from '@ontrails/topography';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'library-render-coherence';
const TOPO_FILE = '<topo>';

const resolveGraph = (
  topo: Parameters<TopoAwareWardenRule['checkTopo']>[0],
  graph: TopoGraph | undefined
): TopoGraph => graph ?? deriveTopoGraph(topo);

const renderTrailIds = (trailIds: readonly string[]): string =>
  trailIds
    .toSorted((left, right) => left.localeCompare(right))
    .map((trailId) => `"${trailId}"`)
    .join(', ');

const collisionDiagnostic = (
  exportName: string,
  trailIds: readonly string[]
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Library rendering export collision on "${exportName}": trails ${renderTrailIds(trailIds)} derive the same package export. Rename one trail or add a library export override before materializing the generated package.`,
  rule: RULE_NAME,
  severity: 'error',
});

const missingTargetDiagnostic = (
  exportName: string,
  trailId: string
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Library rendering export "${exportName}" targets unknown trail "${trailId}". Resolved library exports must stay attached to existing trail contracts.`,
  rule: RULE_NAME,
  severity: 'error',
});

const duplicateExportDiagnostic = (
  exportName: string,
  trailIds: readonly string[]
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Library rendering contains duplicate export "${exportName}" for trails ${renderTrailIds(trailIds)}. The resolved rendering should record the collision and keep only one emitted export.`,
  rule: RULE_NAME,
  severity: 'error',
});

const collectDuplicateExportDiagnostics = (
  rendering: TopoGraphLibraryDerived
): readonly WardenDiagnostic[] => {
  const trailIdsByExport = new Map<string, string[]>();
  for (const entry of rendering.exports) {
    const trailIds = trailIdsByExport.get(entry.exportName) ?? [];
    trailIds.push(entry.trailId);
    trailIdsByExport.set(entry.exportName, trailIds);
  }
  return [...trailIdsByExport.entries()]
    .filter(([, trailIds]) => trailIds.length > 1)
    .map(([exportName, trailIds]) =>
      duplicateExportDiagnostic(exportName, trailIds)
    );
};

const collectMissingTargetDiagnostics = (
  rendering: TopoGraphLibraryDerived,
  knownTrailIds: ReadonlySet<string>
): readonly WardenDiagnostic[] =>
  rendering.exports
    .filter((entry) => !knownTrailIds.has(entry.trailId))
    .map((entry) => missingTargetDiagnostic(entry.exportName, entry.trailId));

export const libraryRenderCoherence: TopoAwareWardenRule = {
  checkTopo(topo, context) {
    const graph = resolveGraph(topo, context?.graph);
    if (!graph.library) {
      return [];
    }

    const knownTrailIds = new Set(topo.trails.keys());
    return [
      ...graph.library.collisions.map((collision) =>
        collisionDiagnostic(collision.exportName, collision.trailIds)
      ),
      ...collectDuplicateExportDiagnostics(graph.library),
      ...collectMissingTargetDiagnostics(graph.library, knownTrailIds),
    ];
  },
  description:
    'Ensure resolved library rendering exports are collision-free and target existing trails.',
  name: RULE_NAME,
  severity: 'error',
};
