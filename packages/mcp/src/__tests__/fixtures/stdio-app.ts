import {
  Result,
  blobRefSchema,
  createBlobRef,
  topo,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { surface } from '../../surface.js';

const greet = trail('greet', {
  description: 'Greet a person',
  examples: [
    {
      expected: { greeting: 'Hello, Ada!' },
      input: { name: 'Ada' },
      name: 'Ada',
    },
  ],
  implementation: (input, ctx) => {
    ctx.progress?.({
      current: 1,
      total: 1,
      ts: new Date().toISOString(),
      type: 'progress',
    });
    return Result.ok({ greeting: `Hello, ${input.name}!` });
  },
  input: z.object({ name: z.string() }),
  intent: 'read',
  output: z.object({ greeting: z.string() }),
});

const file = trail('file', {
  implementation: () =>
    Result.ok(
      createBlobRef({
        data: new Uint8Array([1, 2, 3]),
        mimeType: 'application/pdf',
        name: 'report.pdf',
        size: 3,
      })
    ),
  input: z.object({}),
  intent: 'read',
  output: blobRefSchema,
});

const identity = trail('identity', {
  implementation: (_input, ctx) =>
    Result.ok({ id: ctx.permit?.id ?? 'anonymous' }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ id: z.string() }),
  permit: { scopes: ['identity:read'] },
});

await surface(topo('stdio-fixture', { file, greet, identity }), {
  mcpResources: { examples: true, graph: true, surfaceMap: true },
  // This fixed credential is a test fixture, not a production verifier.
  resolvePermit: ({ _meta }) =>
    Result.ok(
      _meta?.['fixtureCredential'] === 'reader'
        ? { actors: [], id: 'fixture-reader', scopes: ['identity:read'] }
        : undefined
    ),
});
