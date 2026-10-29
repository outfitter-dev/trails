import {
  getTrailVersionEntryKind,
  isArchivedTrailVersionEntry,
} from '@ontrails/core';
import type { Trail } from '@ontrails/core';

import type { PermitDiagnostic } from './rules.js';

type AnyTrail = Trail<unknown, unknown, unknown>;

const scopesOf = (selected: AnyTrail): readonly string[] =>
  selected.permit === undefined || selected.permit === 'public'
    ? []
    : selected.permit.scopes;

const compositionTargets = (selected: AnyTrail): readonly string[] => {
  const targets = [...selected.composes];
  for (const entry of Object.values(selected.versions ?? {})) {
    if (
      isArchivedTrailVersionEntry(entry) ||
      getTrailVersionEntryKind(entry) !== 'fork'
    ) {
      continue;
    }
    targets.push(
      ...(entry.composes ?? []).map((reference) =>
        typeof reference === 'string' ? reference : reference.id
      )
    );
  }
  return targets;
};

/** Compare each trail's declared scopes with its reachable composition contracts. */
export const composeScopeCoverage = (
  trails: readonly AnyTrail[]
): readonly PermitDiagnostic[] => {
  const byId = new Map(trails.map((selected) => [selected.id, selected]));

  return trails.flatMap((parent) => {
    const declared = new Set(scopesOf(parent));
    const missing = new Set<string>();
    const visited = new Set<string>([parent.id]);
    const pending = [...compositionTargets(parent)];

    while (pending.length > 0) {
      const reference = pending.pop();
      if (reference === undefined || visited.has(reference)) {
        continue;
      }
      visited.add(reference);
      const child = byId.get(reference);
      if (child === undefined) {
        continue;
      }
      for (const scope of scopesOf(child)) {
        if (!declared.has(scope)) {
          missing.add(scope);
        }
      }
      pending.push(...compositionTargets(child));
    }

    return missing.size === 0
      ? []
      : [
          {
            message: `Trail "${parent.id}" composes trails requiring undeclared scopes: ${[...missing].toSorted().join(', ')}. Declare every reachable scope on the parent trail.`,
            rule: 'composeScopeCoverage',
            severity: 'warn' as const,
            trailId: parent.id,
          },
        ];
  });
};
