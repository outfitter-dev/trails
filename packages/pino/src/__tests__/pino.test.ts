import { describe, expect, test } from 'bun:test';

import { pinoPackageName } from '../index.js';

describe('@ontrails/pino scaffold', () => {
  test('exports the package identifier', () => {
    expect(pinoPackageName).toBe('@ontrails/pino');
  });
});
