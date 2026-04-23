/**
 * Run file-scoped warden rule trails against a single source file.
 *
 * Returns a flat array of diagnostics from every source-aware rule. Built-in
 * topo-aware rules are dispatched separately via `runTopoAwareWardenTrails()`
 * so callers that loop files do not duplicate graph-level findings.
 */

import type { Topo } from '@ontrails/core';
import { run } from '@ontrails/core';

import { wardenTopoRules } from '../rules/index.js';
import type { WardenDiagnostic } from '../rules/types.js';
import type { RuleOutput } from './schema.js';
import { wardenTopo } from './topo.js';

/**
 * Run all file-scoped warden rule trails for a given file and collect diagnostics.
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
  readonly crudCoverageByEntity?: Readonly<Record<string, readonly string[]>>;
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
  'crudCoverageByEntity',
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

const topoAwareTrailIds = new Set(
  [...wardenTopoRules.keys()].map((ruleName) => `warden.rule.${ruleName}`)
);

export const runWardenTrails = async (
  filePath: string,
  sourceCode: string,
  options?: ProjectRuleOptions
): Promise<readonly WardenDiagnostic[]> => {
  const allDiagnostics: WardenDiagnostic[] = [];
  const input = buildRuleInput(filePath, sourceCode, options);

  for (const id of wardenTopo.ids()) {
    if (topoAwareTrailIds.has(id)) {
      continue;
    }
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

/**
 * Run the built-in topo-aware warden rule trails once against a resolved topo.
 *
 * Unlike `runWardenTrails()`, which is file-scoped, topo-aware rules inspect
 * the compiled graph and should only be dispatched once per topo.
 */
export const runTopoAwareWardenTrails = async (
  topo: Topo
): Promise<readonly WardenDiagnostic[]> => {
  const allDiagnostics: WardenDiagnostic[] = [];

  for (const id of topoAwareTrailIds) {
    const result = await run(wardenTopo, id, { topo });
    if (result.isOk()) {
      appendDiagnostics(
        allDiagnostics,
        (result.value as RuleOutput).diagnostics
      );
    }
  }

  return allDiagnostics;
};
