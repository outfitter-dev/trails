import { describe, expect, test } from 'bun:test';

import { workspaceName } from '../index.js';

describe('lookout workspace placeholder', () => {
  test('reserves the workspace name', () => {
    expect(workspaceName).toBe('lookout');
  });
});
