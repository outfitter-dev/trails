import { describe, expect, test } from 'bun:test';

import { workspaceName } from '../index.js';

describe('stash workspace placeholder', () => {
  test('reserves the workspace name', () => {
    expect(workspaceName).toBe('stash');
  });
});
