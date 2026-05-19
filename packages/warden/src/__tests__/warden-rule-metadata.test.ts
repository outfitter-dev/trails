import { describe, expect, test } from 'bun:test';

import {
  builtinWardenRuleMetadata,
  getWardenRuleMetadata,
  listWardenRuleMetadata,
  wardenRuleLifecycleStates,
  wardenRuleConcerns,
  wardenRuleScopes,
  wardenRuleTiers,
  wardenRules,
  wardenTopoRules,
} from '../rules/index.js';
import type { WardenRuleMetadata } from '../rules/index.js';

const allRuleNames = [...wardenRules.keys(), ...wardenTopoRules.keys()];
const allRuleNameSet = new Set(allRuleNames);
const metadataEntries = Object.entries(builtinWardenRuleMetadata);

const isTemporaryLifecycle = (metadata: WardenRuleMetadata): boolean =>
  metadata.lifecycle.state === 'temporary' ||
  metadata.lifecycle.state === 'deprecated';

describe('warden rule metadata', () => {
  test('classifies every built-in rule and only built-in rules', () => {
    const metadataNames = new Set(metadataEntries.map(([name]) => name));

    expect(allRuleNames.filter((name) => !metadataNames.has(name))).toEqual([]);
    expect(
      [...metadataNames].filter((name) => !allRuleNameSet.has(name)).toSorted()
    ).toEqual([]);
  });

  test('uses the supported tier, depth, concern, scope, and lifecycle vocabulary', () => {
    for (const [, metadata] of metadataEntries) {
      expect(wardenRuleTiers).toContain(metadata.tier);
      expect(['source', 'project', 'topo', 'all']).toContain(metadata.depth);
      expect(wardenRuleConcerns).toContain(metadata.concern);
      expect(wardenRuleScopes).toContain(metadata.scope);
      expect(wardenRuleLifecycleStates).toContain(metadata.lifecycle.state);
    }
  });

  test('derives queryable rule depth from the execution tier', () => {
    expect(getWardenRuleMetadata('no-throw-in-implementation')?.depth).toBe(
      'source'
    );
    expect(getWardenRuleMetadata('on-references-exist')?.depth).toBe('project');
    expect(getWardenRuleMetadata('permit-governance')?.depth).toBe('topo');
    expect(getWardenRuleMetadata('prefer-schema-inference')?.depth).toBe('all');
  });

  test('requires retirement criteria for non-durable rules', () => {
    const missingRetirementCriteria = metadataEntries
      .filter(([, metadata]) => isTemporaryLifecycle(metadata))
      .filter(([, metadata]) => !metadata.lifecycle.retireWhen)
      .map(([name]) => name);

    expect(missingRetirementCriteria).toEqual([]);
  });

  test('exposes metadata lookup helpers for built-in rules', () => {
    expect(getWardenRuleMetadata('permit-governance')?.tier).toBe('topo-aware');
    expect(getWardenRuleMetadata('permit-governance')?.concern).toBe('permits');
    expect(getWardenRuleMetadata('warden-export-symmetry')?.scope).toBe(
      'repo-local'
    );
    expect(listWardenRuleMetadata().length).toBe(allRuleNames.length);
  });

  test('exposes structured guidance for guided built-in rules', () => {
    expect(
      getWardenRuleMetadata('no-throw-in-implementation')?.guidance
    ).toEqual(
      expect.objectContaining({
        docs: [{ label: 'Trail Rules', path: 'AGENTS.md#trail-rules' }],
        relatedRules: [
          'implementation-returns-result',
          'no-native-error-result',
        ],
        summary:
          'Convert thrown failures in blazes into explicit Result.err() outcomes.',
      })
    );
  });

  test('continues to allow unguided built-in rules', () => {
    expect(getWardenRuleMetadata('circular-refs')?.guidance).toBeUndefined();
  });
});
