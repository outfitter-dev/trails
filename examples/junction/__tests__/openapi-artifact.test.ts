/**
 * The committed `openapi.json` must stay current with the graph.
 * Regenerate with `bun bin/generate-openapi.ts` when contracts change.
 */

import { expect, test } from 'bun:test';

import { deriveJunctionOpenApiSpec } from '../src/server.js';

test('committed OpenAPI artifact matches the derived spec', async () => {
  const committed: unknown = JSON.parse(
    await Bun.file(new URL('../openapi.json', import.meta.url)).text()
  );
  expect(committed).toEqual(structuredClone(deriveJunctionOpenApiSpec()));
});
