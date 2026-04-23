import type { Trail } from '@ontrails/core';
import { validatePermits } from '@ontrails/permits';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const toWardenDiagnostic = (
  diagnostic: ReturnType<typeof validatePermits>[number]
): WardenDiagnostic => ({
  filePath: '<topo>',
  line: 1,
  message: diagnostic.message,
  rule: `permit.${diagnostic.rule}`,
  severity: diagnostic.severity === 'error' ? 'error' : 'warn',
});

export const permitGovernance: TopoAwareWardenRule = {
  checkTopo: (topo) =>
    validatePermits(
      topo.list() as readonly Trail<unknown, unknown, unknown>[]
    ).map(toWardenDiagnostic),
  description:
    'Enforces permit declarations and scope hygiene across the compiled topo',
  name: 'permit-governance',
  severity: 'warn',
};
