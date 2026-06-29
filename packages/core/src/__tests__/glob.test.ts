import { describe, expect, test } from 'bun:test';

import { escapeRegExp, matchesGlob } from '../glob.js';
import { includedByPathScope, matchesPathGlob } from '../path-scope.js';
import { matchesTrailIdGlob } from '../trail-id-glob.js';

describe('glob engine', () => {
  test('escapes strings for literal regexp embedding', () => {
    const pattern = new RegExp(`^${escapeRegExp('@ontrails/core?')}$`);

    expect(pattern.test('@ontrails/core?')).toBe(true);
    expect(pattern.test('@ontrails/corex')).toBe(false);
  });

  test('matches segment wildcards without crossing the separator', () => {
    expect(matchesGlob('entity.show', 'entity.*', { separator: '.' })).toBe(
      true
    );
    expect(
      matchesGlob('entity.admin.show', 'entity.*', { separator: '.' })
    ).toBe(false);
  });

  test('matches recursive wildcards across separator depth', () => {
    expect(matchesGlob('src/app.ts', 'src/**/*.ts', { separator: '/' })).toBe(
      true
    );
    expect(
      matchesGlob('src/nested/app.ts', 'src/**/*.ts', { separator: '/' })
    ).toBe(true);
  });

  test('matches terminal recursive patterns at zero depth', () => {
    expect(matchesGlob('entity', 'entity.**', { separator: '.' })).toBe(true);
    expect(matchesGlob('entity.show', 'entity.**', { separator: '.' })).toBe(
      true
    );
    expect(
      matchesGlob('.agents/notes', '.agents/notes/**', {
        separator: '/',
      })
    ).toBe(true);
  });

  test('matches question marks within a segment', () => {
    expect(matchesGlob('user.read', 'user.????', { separator: '.' })).toBe(
      true
    );
    expect(matchesGlob('user.read.many', 'user.????', { separator: '.' })).toBe(
      false
    );
  });
});

describe('path scope', () => {
  test('normalizes leading dot-slash and backslash paths', () => {
    expect(matchesPathGlob('./src/app.ts', 'src/**/*.ts')).toBe(true);
    expect(matchesPathGlob('src\\nested\\app.ts', 'src/**/*.ts')).toBe(true);
    expect(
      includedByPathScope('src/app.ts', {
        include: ['src\\**'],
      })
    ).toBe(true);
  });

  test('applies include, exclude, and extension filters together', () => {
    const scope = {
      exclude: ['src/generated/**'],
      extensions: ['ts'],
      include: ['src/**'],
    };

    expect(includedByPathScope('src/app.ts', scope)).toBe(true);
    expect(includedByPathScope('src/generated/app.ts', scope)).toBe(false);
    expect(includedByPathScope('docs/app.md', scope)).toBe(false);
    expect(includedByPathScope('src/readme.md', scope)).toBe(false);
  });
});

describe('trail-id glob', () => {
  test('matches dotted trail IDs without treating path globs as interchangeable', () => {
    expect(matchesTrailIdGlob('wayfind.search', 'wayfind.*')).toBe(true);
    expect(matchesTrailIdGlob('wayfind.search.deep', 'wayfind.*')).toBe(false);
    expect(matchesTrailIdGlob('wayfind.search.deep', 'wayfind.**')).toBe(true);
  });
});
