import { describe, expect, test } from 'bun:test';

import { workspaceName } from '../index.js';

describe('switchback workspace placeholder', () => {
  test('reserves the workspace name', () => {
    expect(workspaceName).toBe('switchback');
  });
});
