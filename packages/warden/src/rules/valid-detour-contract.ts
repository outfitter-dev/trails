import type { Topo } from '@ontrails/core';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

interface DetourLike {
  readonly on?: unknown;
  readonly recover?: unknown;
}

const isErrorConstructor = (
  value: unknown
): value is abstract new (...args: never[]) => Error => {
  if (typeof value !== 'function') {
    return false;
  }

  const { prototype } = value as { prototype?: unknown };
  return prototype instanceof Error;
};

const describeOnValue = (value: unknown): string => {
  if (typeof value === 'function') {
    const { name } = value as { name?: unknown };
    return typeof name === 'string' && name.length > 0
      ? name
      : '<anonymous constructor>';
  }

  return String(value);
};

const buildDiagnostic = (message: string, rule: string): WardenDiagnostic => ({
  filePath: '<topo>',
  line: 1,
  message,
  rule,
  severity: 'error',
});

const collectTrailDiagnostics = (topo: Topo): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];

  for (const trail of topo.trails.values()) {
    for (const [index, detour] of trail.detours.entries()) {
      const candidate = detour as DetourLike;

      if (!isErrorConstructor(candidate.on)) {
        diagnostics.push(
          buildDiagnostic(
            `Trail "${trail.id}" detour[${index}] must declare an error constructor in on:. Received ${describeOnValue(candidate.on)}.`,
            'valid-detour-contract'
          )
        );
      }

      if (typeof candidate.recover !== 'function') {
        diagnostics.push(
          buildDiagnostic(
            `Trail "${trail.id}" detour[${index}] must declare a callable recover function.`,
            'valid-detour-contract'
          )
        );
      }
    }
  }

  return diagnostics;
};

export const validDetourContract: TopoAwareWardenRule = {
  checkTopo(topo: Topo): readonly WardenDiagnostic[] {
    return collectTrailDiagnostics(topo);
  },
  description:
    'Ensure detours use real error constructors and callable recover functions.',
  name: 'valid-detour-contract',
  severity: 'error',
};
