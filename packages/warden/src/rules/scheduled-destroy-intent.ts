import type { AnyTrail } from '@ontrails/core';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'scheduled-destroy-intent';
const TOPO_FILE = '<topo>';

const isScheduleActivated = (trail: AnyTrail): boolean =>
  trail.activationSources.some(
    (activation) => activation.source.kind === 'schedule'
  );

const scheduleSourceIds = (trail: AnyTrail): readonly string[] => [
  ...new Set(
    trail.activationSources.flatMap((activation) =>
      activation.source.kind === 'schedule' ? [activation.source.id] : []
    )
  ),
];

const buildDiagnostic = (
  trail: AnyTrail,
  sourceIds: readonly string[]
): WardenDiagnostic => ({
  filePath: TOPO_FILE,
  line: 1,
  message: `Trail "${trail.id}" declares intent: 'destroy' and is activated by schedule source${sourceIds.length === 1 ? '' : 's'} ${sourceIds.map((id) => `"${id}"`).join(', ')}. Scheduled destroy work should make cadence, permit scope, idempotency, and recovery explicit before it runs unattended.`,
  rule: RULE_NAME,
  severity: 'warn',
});

export const scheduledDestroyIntent: TopoAwareWardenRule = {
  checkTopo: (topo) =>
    topo
      .list()
      .filter(
        (trail) => trail.intent === 'destroy' && isScheduleActivated(trail)
      )
      .map((trail) => buildDiagnostic(trail, scheduleSourceIds(trail))),
  description:
    'Warn when destroy-intent trails are activated by schedule sources.',
  name: RULE_NAME,
  severity: 'warn',
};
