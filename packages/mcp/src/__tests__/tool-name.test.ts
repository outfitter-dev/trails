import { describe, expect, test } from 'bun:test';

import { deriveToolName } from '../tool-name.js';

describe('deriveToolName', () => {
  test('replaces dots with underscores', () => {
    expect(deriveToolName('myapp', 'entity.show')).toBe('myapp_entity_show');
  });

  test('prefixes with app name', () => {
    expect(deriveToolName('myapp', 'search')).toBe('myapp_search');
  });

  test('handles multiple dots', () => {
    expect(deriveToolName('myapp', 'entity.onboard')).toBe(
      'myapp_entity_onboard'
    );
  });

  test('replaces hyphens with underscores', () => {
    expect(deriveToolName('my-app', 'some-trail')).toBe('my_app_some_trail');
  });

  test('lowercases everything', () => {
    expect(deriveToolName('MyApp', 'Entity.Show')).toBe('myapp_entity_show');
  });

  test('handles single-segment trail IDs', () => {
    expect(deriveToolName('dispatch', 'search')).toBe('dispatch_search');
  });

  test('handles dots in app name', () => {
    expect(deriveToolName('my.app', 'trail')).toBe('my_app_trail');
  });

  test('matches spec examples', () => {
    expect(deriveToolName('myapp', 'entity.show')).toBe('myapp_entity_show');
    expect(deriveToolName('myapp', 'search')).toBe('myapp_search');
    expect(deriveToolName('myapp', 'entity.onboard')).toBe(
      'myapp_entity_onboard'
    );
    expect(deriveToolName('dispatch', 'patch.search')).toBe(
      'dispatch_patch_search'
    );
  });
});
