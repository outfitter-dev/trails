import { expect, test } from 'bun:test';
import {
  InternalError,
  Result,
  TrailsError,
  ValidationError,
  run,
  topo,
  trail,
} from '@ontrails/core';
import { testAll } from '@ontrails/testing';
import { z } from 'zod';

import { blob, createBlobMock } from '../index.js';

const uploads = blob('uploads');
const inspect = trail('upload.inspect', {
  examples: [
    {
      expected: { size: null },
      input: { key: 'missing' },
      name: 'missing object',
    },
  ],
  implementation: async (input, ctx) => {
    try {
      const info = await uploads.from(ctx).head(input.key);
      return Result.ok({
        size: info?.size ?? null,
      });
    } catch (error) {
      return Result.err(
        error instanceof TrailsError
          ? error
          : new InternalError('Blob binding failed')
      );
    }
  },
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ size: z.number().nullable() }),
  resources: [uploads],
});

test('role is frozen and inspectable without changing core resource semantics', async () => {
  expect(uploads.role).toBe('blob');
  expect(uploads.kind).toBe('resource');
  expect(Object.isFrozen(uploads)).toBe(true);
  expect(topo('inspect-role', { uploads }).getResource('uploads')).toBe(
    uploads
  );
  const result = await uploads.create({
    config: undefined,
    cwd: '/',
    env: {},
    workspaceRoot: undefined,
  });
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('resource overrides');
    if (result.error instanceof ValidationError) {
      expect(result.error.context?.['resourceId']).toBe('uploads');
    }
  }
});

test('ordinary overrides and resource accessors resolve the binding', async () => {
  const client = createBlobMock();
  await client.put('key', new Uint8Array([1, 2]));
  const result = await run(
    topo('blob-override', { inspect, uploads }),
    'upload.inspect',
    { key: 'key' },
    { resources: { uploads: client } }
  );
  expect(result.isOk()).toBe(true);
  if (result.isOk()) {
    expect(result.value).toEqual({ size: 2 });
  }
});

test('default mocks are isolated between resolutions', async () => {
  const first = await uploads.mock?.();
  const second = await uploads.mock?.();
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  await first?.put('key', new Uint8Array([1]));
  expect(await second?.get('key')).toBeNull();
});

testAll(topo('blob-contract', { inspect, uploads }));
