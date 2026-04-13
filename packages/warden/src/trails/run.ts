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

type TrailIntentMap = Readonly<Record<string, 'destroy' | 'read' | 'write'>>;

interface ProjectRuleOptions {
  readonly contourReferencesByName?: Readonly<
    Record<string, readonly string[]>
  >;
  readonly crossTargetTrailIds?: readonly string[];
  readonly crudTableIds?: readonly string[];
  readonly detourTargetTrailIds?: readonly string[];
  readonly knownContourIds?: readonly string[];
  readonly knownResourceIds?: readonly string[];
  readonly knownSignalIds?: readonly string[];
  readonly knownTrailIds?: readonly string[];
  readonly onTargetSignalIds?: readonly string[];
  readonly reconcileTableIds?: readonly string[];
  readonly trailIntentsById?: TrailIntentMap;
}

const PROJECT_OPTION_KEYS = [
  'contourReferencesByName',
  'crossTargetTrailIds',
  'crudTableIds',
  'detourTargetTrailIds',
  'knownContourIds',
  'knownResourceIds',
  'knownSignalIds',
  'knownTrailIds',
  'onTargetSignalIds',
  'reconcileTableIds',
  'trailIntentsById',
] as const satisfies readonly (keyof ProjectRuleOptions)[];

const hasProjectOptions = (options?: ProjectRuleOptions): boolean =>
  Boolean(
    options && PROJECT_OPTION_KEYS.some((key) => options[key] !== undefined)
  );

const collectProjectOptions = (
  options?: ProjectRuleOptions
): ProjectRuleOptions => {
  if (!options) {
    return {};
  }

  return Object.fromEntries(
    PROJECT_OPTION_KEYS.flatMap((key) => {
      const value = options[key];
      return value === undefined ? [] : [[key, value] as const];
    })
  ) as ProjectRuleOptions;
};

const buildRuleInput = (
  filePath: string,
  sourceCode: string,
  options?: ProjectRuleOptions
): {
  readonly filePath: string;
  readonly sourceCode: string;
} & ProjectRuleOptions => {
  const base = { filePath, sourceCode };
  if (!hasProjectOptions(options)) {
    return base;
  }

  return { ...base, ...collectProjectOptions(options) };
};

export const runWardenTrails = async (
  filePath: string,
  sourceCode: string,
  options?: ProjectRuleOptions
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
