/**
 * Run all warden rule trails against a single source file.
 *
 * Returns a flat array of diagnostics from every rule.
 */

import { run } from '@ontrails/core';

import type { WardenDiagnostic } from '../rules/types.js';
import type { RuleOutput } from './schema.js';
import { wardenTopo } from './topo.js';

/**
 * Run all warden rule trails for a given file and collect diagnostics.
 *
 * Each rule trail runs independently. Errors from individual trails are
 * silently skipped so that one broken rule does not block the rest.
 */
const appendDiagnostics = (
  target: WardenDiagnostic[],
  diagnostics: readonly WardenDiagnostic[]
): void => {
  for (const diagnostic of diagnostics) {
    target.push(diagnostic);
  }
};

const hasProjectOptions = (
  options:
    | {
        readonly crossTargetTrailIds?: readonly string[];
        readonly detourTargetTrailIds?: readonly string[];
        readonly knownResourceIds?: readonly string[];
        readonly knownSignalIds?: readonly string[];
        readonly knownTrailIds?: readonly string[];
        readonly trailIntentsById?: Readonly<
          Record<string, 'destroy' | 'read' | 'write'>
        >;
      }
    | undefined
): boolean =>
  Boolean(
    options?.crossTargetTrailIds ||
    options?.detourTargetTrailIds ||
    options?.knownResourceIds ||
    options?.knownSignalIds ||
    options?.knownTrailIds ||
    options?.trailIntentsById
  );

const buildRuleInput = (
  filePath: string,
  sourceCode: string,
  options:
    | {
        readonly crossTargetTrailIds?: readonly string[];
        readonly detourTargetTrailIds?: readonly string[];
        readonly knownResourceIds?: readonly string[];
        readonly knownSignalIds?: readonly string[];
        readonly knownTrailIds?: readonly string[];
        readonly trailIntentsById?: Readonly<
          Record<string, 'destroy' | 'read' | 'write'>
        >;
      }
    | undefined
):
  | {
      readonly filePath: string;
      readonly sourceCode: string;
    }
  | {
      readonly crossTargetTrailIds?: readonly string[];
      readonly detourTargetTrailIds?: readonly string[];
      readonly filePath: string;
      readonly knownResourceIds?: readonly string[];
      readonly knownSignalIds?: readonly string[];
      readonly knownTrailIds?: readonly string[];
      readonly sourceCode: string;
      readonly trailIntentsById?: Readonly<
        Record<string, 'destroy' | 'read' | 'write'>
      >;
    } => {
  const base = { filePath, sourceCode };
  if (!hasProjectOptions(options)) {
    return base;
  }

  return {
    ...base,
    ...(options?.crossTargetTrailIds
      ? { crossTargetTrailIds: options.crossTargetTrailIds }
      : {}),
    ...(options?.detourTargetTrailIds
      ? { detourTargetTrailIds: options.detourTargetTrailIds }
      : {}),
    ...(options?.knownResourceIds
      ? { knownResourceIds: options.knownResourceIds }
      : {}),
    ...(options?.knownSignalIds
      ? { knownSignalIds: options.knownSignalIds }
      : {}),
    ...(options?.knownTrailIds ? { knownTrailIds: options.knownTrailIds } : {}),
    ...(options?.trailIntentsById
      ? { trailIntentsById: options.trailIntentsById }
      : {}),
  };
};

export const runWardenTrails = async (
  filePath: string,
  sourceCode: string,
  options?: {
    readonly crossTargetTrailIds?: readonly string[];
    readonly detourTargetTrailIds?: readonly string[];
    readonly knownResourceIds?: readonly string[];
    readonly knownSignalIds?: readonly string[];
    readonly knownTrailIds?: readonly string[];
    readonly trailIntentsById?: Readonly<
      Record<string, 'destroy' | 'read' | 'write'>
    >;
  }
): Promise<readonly WardenDiagnostic[]> => {
  const allDiagnostics: WardenDiagnostic[] = [];
  const input = buildRuleInput(filePath, sourceCode, options);

  for (const id of wardenTopo.ids()) {
    const result = await run(wardenTopo, id, input);
    if (result.isOk()) {
      appendDiagnostics(
        allDiagnostics,
        (result.value as RuleOutput).diagnostics
      );
    }
  }

  return allDiagnostics;
};
