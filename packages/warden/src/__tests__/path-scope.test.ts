import { describe, expect, test } from 'bun:test';

import { matchesPathPattern } from '../path-scope.js';

describe('path-scope', () => {
  test('matches recursive globs at the root and in nested directories', () => {
    expect(matchesPathPattern('root.ts', '**/*.ts')).toBe(true);
    expect(matchesPathPattern('src/root.ts', '**/*.ts')).toBe(true);
    expect(matchesPathPattern('src/nested/root.ts', '**/*.ts')).toBe(true);
    expect(matchesPathPattern('src/root.md', '**/*.ts')).toBe(false);
  });

  test('matches directory globs without swallowing sibling paths', () => {
    expect(matchesPathPattern('.agents/notes', '.agents/notes/**')).toBe(true);
    expect(
      matchesPathPattern('.agents/notes/plan.md', '.agents/notes/**')
    ).toBe(true);
    expect(
      matchesPathPattern('.agents/skills/demo/SKILL.md', '.agents/notes/**')
    ).toBe(false);
  });
});
