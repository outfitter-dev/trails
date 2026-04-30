import { describe, expect, test } from 'bun:test';

import * as warden from '@ontrails/warden';
import { parse, walk } from '@ontrails/warden/ast';

describe('@ontrails/warden public API', () => {
  test('keeps parser helpers on the ast entrypoint', () => {
    expect('parse' in warden).toBe(false);
    expect('walk' in warden).toBe(false);

    const ast = parse('example.ts', 'export const value = 1;');
    expect(ast).not.toBeNull();

    let visited = 0;
    if (ast) {
      walk(ast, () => {
        visited += 1;
      });
    }
    expect(visited).toBeGreaterThan(0);
  });
});
