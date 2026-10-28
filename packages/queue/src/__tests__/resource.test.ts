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

import { createQueueMock, queueProducer } from '../index.js';

const jobs = queueProducer<{ id: string }>('jobs');
const enqueue = trail('job.enqueue', {
  examples: [
    {
      expected: { accepted: true },
      input: { id: 'example' },
      name: 'accepted submission',
    },
  ],
  implementation: async (input, ctx) => {
    try {
      await jobs.from(ctx).send(input);
      return Result.ok({ accepted: true });
    } catch (error) {
      return Result.err(
        error instanceof TrailsError
          ? error
          : new InternalError('Queue binding failed')
      );
    }
  },
  input: z.object({ id: z.string() }),
  intent: 'write',
  output: z.object({ accepted: z.boolean() }),
  resources: [jobs],
});

test('resource role is frozen and unbound creation fails explicitly', async () => {
  expect(jobs.role).toBe('queue');
  expect(jobs.kind).toBe('resource');
  expect(Object.isFrozen(jobs)).toBe(true);
  expect(topo('inspect-role', { jobs }).getResource('jobs')).toBe(jobs);
  const result = await jobs.create({
    config: undefined,
    cwd: '/',
    env: {},
    workspaceRoot: undefined,
  });
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('resource overrides');
  }
});

test('ordinary overrides preserve producer behavior and typed failures', async () => {
  const client = createQueueMock<{ id: string }>();
  const app = topo('queue-overrides', { enqueue, jobs });
  const accepted = await run(
    app,
    'job.enqueue',
    { id: 'job' },
    { resources: { jobs: client } }
  );
  expect(accepted.isOk()).toBe(true);
  expect(client.messages()).toEqual([{ body: { id: 'job' } }]);
  const failure = new ValidationError('Provider rejected submission');
  const rejected = await run(
    app,
    'job.enqueue',
    { id: 'job' },
    {
      resources: {
        jobs: {
          ...client,
          send: async () => {
            throw failure;
          },
        },
      },
    }
  );
  expect(rejected.isErr()).toBe(true);
  if (rejected.isErr()) {
    expect(rejected.error).toBe(failure);
  }
});

test('default mocks are independent', async () => {
  const first = await jobs.mock?.();
  const second = await jobs.mock?.();
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  await first?.send({ id: 'one' });
  // Inspectability belongs to createQueueMock, not the production client type.
  expect(first).not.toBe(second);
});

testAll(topo('queue-contract', { enqueue, jobs }));
