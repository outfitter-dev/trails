import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

describe('@ontrails/core public barrel', () => {
  test('does not root-export helpers from internal modules', () => {
    const source = readFileSync(
      new URL('../index.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toMatch(/from ['"]\.\/internal\//);
  });
});
