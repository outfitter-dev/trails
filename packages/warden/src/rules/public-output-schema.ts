import { filterSurfaceTrails } from '@ontrails/core';
import type { AnyTrail, Topo } from '@ontrails/core';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'public-output-schema';
const TOPO_FILE = '<topo>';

const diagnosticForTrail = (trail: AnyTrail): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message:
    `Trail "${trail.id}" is visible to public MCP/HTTP surface rendering but does not declare an output schema. ` +
    'Add an explicit output schema, or mark the trail visibility as internal if it is composition-only.',
  rule: RULE_NAME,
  severity: 'error',
});

export const publicOutputSchema: TopoAwareWardenRule = {
  checkTopo(topo: Topo): readonly WardenDiagnostic[] {
    return filterSurfaceTrails(topo.list()).flatMap((trail) =>
      trail.output === undefined ? [diagnosticForTrail(trail)] : []
    );
  },
  description:
    'Require public MCP/HTTP surface-eligible trails to declare output schemas.',
  name: RULE_NAME,
  severity: 'error',
};
