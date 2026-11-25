import { describe, expect, test } from 'bun:test';

import { isProvenanceOnlyLockChange } from '../skillset-lock-provenance.js';

const lock = () => ({
  items: [
    { sourceHash: 'content', sourcePath: '.skillset/skills/example/SKILL.md' },
  ] satisfies [unknown],
  marketplaces: {
    entries: [
      {
        generatedPaths: ['.claude-plugin/marketplace.json'],
        requested: { kind: 'local' },
        resolved: { ref: 'main', sha: 'before', sourceKind: 'current' },
      },
    ] satisfies [unknown],
  },
  provenanceHash: 'before',
});

describe('Skillset lock provenance-only changes', () => {
  test('recognizes only checkout provenance on local/current entries', () => {
    const before = lock();
    const after = lock();
    after.provenanceHash = 'after';
    after.marketplaces.entries[0].resolved.ref = 'feature';
    after.marketplaces.entries[0].resolved.sha = 'after';
    expect(
      isProvenanceOnlyLockChange(JSON.stringify(before), JSON.stringify(after))
    ).toBe(true);
    expect(
      isProvenanceOnlyLockChange(JSON.stringify(before), JSON.stringify(before))
    ).toBe(false);
  });

  test('preserves content, manifest paths, cache paths and external provenance', () => {
    const before = lock();
    for (const mutate of [
      (value: ReturnType<typeof lock>) => {
        value.items[0].sourceHash = 'new';
      },
      (value: ReturnType<typeof lock>) => {
        value.items[0].sourcePath =
          '.skillset/cache/latest/.skillset/skills/example/SKILL.md';
      },
      (value: ReturnType<typeof lock>) => {
        value.marketplaces.entries[0].generatedPaths = [];
      },
    ]) {
      const after = lock();
      after.provenanceHash = 'after';
      mutate(after);
      expect(
        isProvenanceOnlyLockChange(
          JSON.stringify(before),
          JSON.stringify(after)
        )
      ).toBe(false);
    }
    before.marketplaces.entries[0].requested.kind = 'git';
    const after = structuredClone(before);
    after.marketplaces.entries[0].resolved.sha = 'new';
    expect(
      isProvenanceOnlyLockChange(JSON.stringify(before), JSON.stringify(after))
    ).toBe(false);
  });

  test('does not classify formatting alone or malformed lock data as provenance', () => {
    expect(
      isProvenanceOnlyLockChange(
        JSON.stringify(lock()),
        JSON.stringify(lock(), null, 2)
      )
    ).toBe(false);
    expect(() => isProvenanceOnlyLockChange('{', '{}')).toThrow();
    expect(() => isProvenanceOnlyLockChange('null', '{}')).toThrow();
  });
});
