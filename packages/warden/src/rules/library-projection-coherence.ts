import { deriveTopoGraph } from '@ontrails/topography';
import type {
  TopoGraph,
  TopoGraphLibraryProjection,
} from '@ontrails/topography';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'library-projection-coherence';
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
  message: `Library projection export collision on "${exportName}": trails ${renderTrailIds(trailIds)} derive the same package export. Rename one trail or add a library export override before materializing the generated package.`,
  rule: RULE_NAME,
  severity: 'error',
});

const missingTargetDiagnostic = (
  exportName: string,
  trailId: string
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Library projection export "${exportName}" targets unknown trail "${trailId}". Resolved library exports must stay attached to existing trail contracts.`,
  rule: RULE_NAME,
  severity: 'error',
});

const duplicateExportDiagnostic = (
  exportName: string,
  trailIds: readonly string[]
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Library projection contains duplicate export "${exportName}" for trails ${renderTrailIds(trailIds)}. The resolved projection should record the collision and keep only one emitted export.`,
  rule: RULE_NAME,
  severity: 'error',
});

const collectDuplicateExportDiagnostics = (
  projection: TopoGraphLibraryProjection
): readonly WardenDiagnostic[] => {
  const trailIdsByExport = new Map<string, string[]>();
  for (const entry of projection.exports) {
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
  projection: TopoGraphLibraryProjection,
  knownTrailIds: ReadonlySet<string>
): readonly WardenDiagnostic[] =>
  projection.exports
    .filter((entry) => !knownTrailIds.has(entry.trailId))
    .map((entry) => missingTargetDiagnostic(entry.exportName, entry.trailId));

export const libraryProjectionCoherence: TopoAwareWardenRule = {
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
    'Ensure resolved library projection exports are collision-free and target existing trails.',
  name: RULE_NAME,
  severity: 'error',
};
