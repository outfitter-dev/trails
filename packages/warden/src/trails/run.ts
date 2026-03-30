/**
 * Run all warden rule trails against a single source file.
 *
 * Returns a flat array of diagnostics from every rule.
 */

import { dispatch } from '@ontrails/core';

import type { WardenDiagnostic } from '../rules/types.js';
import type { RuleOutput } from './schema.js';
import { wardenTopo } from './topo.js';

/**
 * Dispatch all warden rule trails for a given file and collect diagnostics.
 *
 * Each rule trail runs independently. Errors from individual trails are
 * silently skipped so that one broken rule does not block the rest.
 */
export const runWardenTrails = async (
  filePath: string,
  sourceCode: string,
  options?: {
    readonly knownServiceIds?: readonly string[];
    readonly knownTrailIds?: readonly string[];
  }
): Promise<readonly WardenDiagnostic[]> => {
  const allDiagnostics: WardenDiagnostic[] = [];

  for (const id of wardenTopo.ids()) {
    const input =
      options?.knownTrailIds || options?.knownServiceIds
        ? {
            filePath,
            ...(options?.knownServiceIds
              ? { knownServiceIds: options.knownServiceIds }
              : {}),
            ...(options?.knownTrailIds
              ? { knownTrailIds: options.knownTrailIds }
              : {}),
            sourceCode,
          }
        : { filePath, sourceCode };
    const result = await dispatch(wardenTopo, id, input);
    if (result.isOk()) {
      const { diagnostics } = result.value as RuleOutput;
      for (const d of diagnostics) {
        allDiagnostics.push(d);
      }
    }
  }

  return allDiagnostics;
};
