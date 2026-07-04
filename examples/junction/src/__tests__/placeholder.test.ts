import { describe, expect, test } from 'bun:test';

import { workspaceName } from '../index.js';

describe('junction workspace placeholder', () => {
  test('reserves the workspace name', () => {
    expect(workspaceName).toBe('junction');
  });
});
