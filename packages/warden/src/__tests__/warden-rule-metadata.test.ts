import { describe, expect, test } from 'bun:test';

import {
  builtinWardenRuleMetadata,
  getWardenRuleMetadata,
  listWardenRuleMetadata,
  wardenRuleLifecycleStates,
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

  test('uses the supported tier, scope, and lifecycle vocabulary', () => {
    for (const [, metadata] of metadataEntries) {
      expect(wardenRuleTiers).toContain(metadata.tier);
      expect(wardenRuleScopes).toContain(metadata.scope);
      expect(wardenRuleLifecycleStates).toContain(metadata.lifecycle.state);
    }
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
    expect(getWardenRuleMetadata('warden-export-symmetry')?.scope).toBe(
      'repo-local'
    );
    expect(listWardenRuleMetadata().length).toBe(allRuleNames.length);
  });
});
