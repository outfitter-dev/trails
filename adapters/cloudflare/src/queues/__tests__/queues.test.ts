import { describe, expect, test } from 'bun:test';

import {
  RateLimitError,
  Result,
  ValidationError,
  queue,
  topo,
  trail,
} from '@ontrails/core';
import type { TraceRecord, TraceSink } from '@ontrails/core';
import { z } from 'zod';

import { createWorkersHandler, getEnvBinding } from '../../workers/index.js';
import { createMemoryKv, cloudflareKv } from '../../kv/index.js';
import {
  cloudflareQueue,
  createMemoryQueue,
  createQueueHandler,
} from '../index.js';
import type {
  CloudflareQueueBatch,
  CloudflareQueueMessage,
  CloudflareQueueRetryOptions,
} from '../index.js';

interface TestMessage<Body = unknown> extends CloudflareQueueMessage<Body> {
  readonly ackCount: number;
  readonly retriedWith: CloudflareQueueRetryOptions | undefined;
}

interface TestBatch<Body = unknown> extends CloudflareQueueBatch<Body> {
  readonly ackAllCount: number;
  readonly retryAllCount: number;
  readonly retryAllOptions: CloudflareQueueRetryOptions | undefined;
}

const testMessage = <Body>(
  body: Body,
  overrides: Partial<Pick<CloudflareQueueMessage<Body>, 'attempts' | 'id'>> = {}
): TestMessage<Body> => {
  let ackCount = 0;
  let retriedWith: CloudflareQueueRetryOptions | undefined;
  return {
    ack() {
      ackCount += 1;
    },
    get ackCount() {
      return ackCount;
    },
    attempts: overrides.attempts ?? 1,
    body,
    id: overrides.id ?? 'msg_1',
    get retriedWith() {
      return retriedWith;
    },
    retry(options) {
      retriedWith = options ?? {};
    },
    timestamp: new Date('2026-07-07T00:00:00.000Z'),
  };
};

const testBatch = <Body>(
  queueName: string,
  messages: readonly TestMessage<Body>[]
): TestBatch<Body> => {
  let ackAllCount = 0;
  let retryAllCount = 0;
  let retryAllOptions: CloudflareQueueRetryOptions | undefined;
  return {
    ackAll() {
      ackAllCount += 1;
    },
    get ackAllCount() {
      return ackAllCount;
    },
    messages,
    queue: queueName,
    retryAll(options) {
      retryAllCount += 1;
      retryAllOptions = options ?? {};
    },
    get retryAllCount() {
      return retryAllCount;
    },
    get retryAllOptions() {
      return retryAllOptions;
    },
  };
};

describe('cloudflareQueue', () => {
  test('records producer sends in the in-memory mock', async () => {
    const jobs = createMemoryQueue<{ id: string }>();

    await jobs.send({ id: 'one' }, { delaySeconds: 5 });
    await jobs.sendBatch([{ body: { id: 'two' } }], { delaySeconds: 10 });

    expect(jobs.messages()).toEqual([
      { body: { id: 'one' }, options: { delaySeconds: 5 } },
      { body: { id: 'two' }, options: { delaySeconds: 10 } },
    ]);
    expect(await jobs.metrics()).toMatchObject({ backlogCount: 2 });
  });

  test('registers an env binding for Queue producer resources', async () => {
    const jobs = cloudflareQueue<{ id: string }>('jobs', { binding: 'JOBS' });
    const binding = getEnvBinding(jobs);
    const producer = createMemoryQueue<{ id: string }>();

    const resolved = binding?.fromEnv(producer);

    expect(binding?.binding).toBe('JOBS');
    expect(resolved?.isOk()).toBe(true);
    if (resolved?.isOk()) {
      await resolved.value.send({ id: 'job_1' });
    }
    expect(producer.messages()).toEqual([{ body: { id: 'job_1' } }]);
  });
});

describe('createQueueHandler', () => {
  test('acks a message after its queue consumer succeeds', async () => {
    const consumed: string[] = [];
    const consume = trail('job.consume', {
      implementation: (input) => {
        consumed.push(input.id);
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.string() }),
          queue: 'jobs',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createQueueHandler(topo('queues', { consume }));
    const message = testMessage({ id: 'job_1' });

    await handler(testBatch('jobs', [message]));

    expect(consumed).toEqual(['job_1']);
    expect(message.ackCount).toBe(1);
    expect(message.retriedWith).toBeUndefined();
  });

  test('normalizes manually authored queue names before registration', async () => {
    const consumed: string[] = [];
    const consume = trail('job.consume', {
      implementation: (input) => {
        consumed.push(input.id);
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      on: [
        {
          id: 'queue.jobs',
          kind: 'queue',
          parse: z.object({ id: z.string() }),
          queue: ' jobs ',
        },
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createQueueHandler(topo('queues-manual', { consume }));
    const message = testMessage({ id: 'job_1' });

    await handler(testBatch('jobs', [message]));

    expect(consumed).toEqual(['job_1']);
    expect(message.ackCount).toBe(1);
  });

  test('rejects incompatible source contracts on one physical queue', () => {
    const consumeJob = trail('job.consume', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.string() }),
          queue: 'shared',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const consumeEmail = trail('email.consume', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({ address: z.string().email() }),
      on: [
        queue('queue.email', {
          parse: z.object({ address: z.string().email() }),
          queue: 'shared',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });

    expect(() =>
      createQueueHandler(
        topo('queues-incompatible', { consumeEmail, consumeJob })
      )
    ).toThrow('incompatible activation source contracts');
  });

  test('rejects queue payloads incompatible with the consumer input', () => {
    const consume = trail('job.consume', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.number() }),
          queue: 'jobs',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });

    expect(() =>
      createQueueHandler(topo('queues-incompatible-input', { consume }))
    ).toThrow(ValidationError);
  });

  test('allows multiple trails to share one queue source contract', async () => {
    const source = queue('queue.jobs', {
      parse: z.object({ id: z.string() }),
      queue: 'jobs',
    });
    const consumed: string[] = [];
    const first = trail('job.first', {
      implementation: (input) => {
        consumed.push(`first:${input.id}`);
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      on: [source],
      output: z.object({ ok: z.boolean() }),
    });
    const second = trail('job.second', {
      implementation: (input) => {
        consumed.push(`second:${input.id}`);
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      on: [source],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createQueueHandler(
      topo('queues-shared', { first, second })
    );
    const message = testMessage({ id: 'job_1' });

    await handler(testBatch('jobs', [message]));

    expect(consumed).toEqual(['first:job_1', 'second:job_1']);
    expect(message.ackCount).toBe(1);
  });

  test('acknowledges a permanently invalid message without retrying', async () => {
    const consume = trail('job.consume', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.string() }),
          queue: 'jobs',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createQueueHandler(topo('queues-invalid', { consume }));
    const message = testMessage({ id: 42 });

    await handler(testBatch('jobs', [message]));

    expect(message.ackCount).toBe(1);
    expect(message.retriedWith).toBeUndefined();
  });

  test('passes RateLimitError retryAfter through to Queue retry delay', async () => {
    const consume = trail('job.consume', {
      implementation: () =>
        Result.err(new RateLimitError('slow down', { retryAfter: 30 })),
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.string() }),
          queue: 'jobs',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createQueueHandler(topo('queues-rate-limit', { consume }));
    const message = testMessage({ id: 'job_1' });

    await handler(testBatch('jobs', [message]));

    expect(message.ackCount).toBe(0);
    expect(message.retriedWith).toEqual({ delaySeconds: 30 });
  });

  test('acknowledges a message when a queue where predicate throws', async () => {
    const consume = trail('job.consume', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [
        {
          source: queue('queue.jobs', {
            parse: z.object({ id: z.string() }),
            queue: 'jobs',
          }),
          where: () => {
            throw new Error('predicate failed');
          },
        },
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createQueueHandler(
      topo('queues-predicate-throw', { consume })
    );
    const message = testMessage({ id: 'job_1' });

    await handler(testBatch('jobs', [message]));

    expect(message.ackCount).toBe(1);
    expect(message.retriedWith).toBeUndefined();
  });

  test('acknowledges a message when an async queue where predicate rejects', async () => {
    const consume = trail('job.consume', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [
        {
          source: queue('queue.jobs', {
            parse: z.object({ id: z.string() }),
            queue: 'jobs',
          }),
          where: () => Promise.reject(new Error('predicate rejected')),
        },
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createQueueHandler(
      topo('queues-predicate-reject', { consume })
    );
    const message = testMessage({ id: 'job_1' });

    await handler(testBatch('jobs', [message]));

    expect(message.ackCount).toBe(1);
    expect(message.retriedWith).toBeUndefined();
  });

  test('writes queue activation records to topo-local trace sinks', async () => {
    const records: TraceRecord[] = [];
    const traceSink: TraceSink = {
      write(record) {
        records.push(record);
      },
    };
    const consume = trail('job.consume', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.string() }),
          queue: 'jobs',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createQueueHandler(
      topo(
        'queues-trace',
        { consume },
        topo.options({ observe: { trace: traceSink } })
      )
    );
    const message = testMessage({ id: 'job_1' });

    await handler(testBatch('jobs', [message]));

    expect(records.map((record) => record.name)).toEqual([
      'activation.queue',
      'job.consume',
    ]);
    expect(records[1]?.parentId).toBe(records[0]?.id);
  });

  test('queue-activated trails resolve env-bound resources through Workers env', async () => {
    const flags = cloudflareKv('flags.queue', { binding: 'FLAGS' });
    const consume = trail('job.consume', {
      implementation: async (input, ctx) => {
        await flags.from(ctx).put(`queue/${input.id}`, 'done');
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.string() }),
          queue: 'jobs',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
      resources: [flags],
    });
    const worker = createWorkersHandler(
      topo('queues-worker-env', { consume, flags })
    );
    const kv = createMemoryKv();
    const message = testMessage({ id: 'job_1' });

    await worker.queue(testBatch('jobs', [message]), { FLAGS: kv });

    expect(message.ackCount).toBe(1);
    expect(await kv.get('queue/job_1')).toBe('done');
  });

  test('queue materialization includes composed trail resources', async () => {
    const flags = cloudflareKv('flags.child', { binding: 'CHILD_FLAGS' });
    const persist = trail('job.persist', {
      implementation: async (input, ctx) => {
        await flags.from(ctx).put(`child/${input.id}`, 'done');
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
      resources: [flags],
      visibility: 'internal',
    });
    const consume = trail('job.consume', {
      composes: [persist.id],
      implementation: async (input, ctx) =>
        await ctx.compose(persist.id, input),
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.string() }),
          queue: 'jobs',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const worker = createWorkersHandler(
      topo('queues-composed-resource', { consume, flags, persist })
    );
    const kv = createMemoryKv();
    const message = testMessage({ id: 'job_1' });

    await worker.queue(testBatch('jobs', [message]), { CHILD_FLAGS: kv });

    expect(message.ackCount).toBe(1);
    expect(await kv.get('child/job_1')).toBe('done');
  });

  test('queue materialization requires bindings only for the delivered queue', async () => {
    const jobFlags = cloudflareKv('flags.jobs', { binding: 'JOB_FLAGS' });
    const emailFlags = cloudflareKv('flags.emails', {
      binding: 'EMAIL_FLAGS',
    });
    const consumeJob = trail('job.consume', {
      implementation: async (input, ctx) => {
        await jobFlags.from(ctx).put(`job/${input.id}`, 'done');
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.string() }),
          queue: 'jobs',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
      resources: [jobFlags],
    });
    const consumeEmail = trail('email.consume', {
      implementation: async (input, ctx) => {
        await emailFlags.from(ctx).put(`email/${input.id}`, 'done');
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.emails', {
          parse: z.object({ id: z.string() }),
          queue: 'emails',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
      resources: [emailFlags],
    });
    const worker = createWorkersHandler(
      topo('queues-delivery-isolation', {
        consumeEmail,
        consumeJob,
        emailFlags,
        jobFlags,
      })
    );
    const kv = createMemoryKv();
    const message = testMessage({ id: 'job_1' });

    await worker.queue(testBatch('jobs', [message]), { JOB_FLAGS: kv });

    expect(message.ackCount).toBe(1);
    expect(await kv.get('job/job_1')).toBe('done');
  });

  test('queue materialization ignores fetch-only env resources', async () => {
    const queueFlags = cloudflareKv('flags.queue', { binding: 'QUEUE_FLAGS' });
    const fetchFlags = cloudflareKv('flags.fetch', { binding: 'FETCH_FLAGS' });
    const consume = trail('job.consume', {
      implementation: async (input, ctx) => {
        await queueFlags.from(ctx).put(`queue/${input.id}`, 'done');
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      on: [
        queue('queue.jobs', {
          parse: z.object({ id: z.string() }),
          queue: 'jobs',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
      resources: [queueFlags],
    });
    const showFlag = trail('flag.show', {
      implementation: async (input, ctx) =>
        Result.ok({ value: await fetchFlags.from(ctx).get(input.key) }),
      input: z.object({ key: z.string() }),
      intent: 'read',
      output: z.object({ value: z.string().nullable() }),
      resources: [fetchFlags],
    });
    const worker = createWorkersHandler(
      topo('queues-worker-entrypoint-isolation', {
        consume,
        fetchFlags,
        queueFlags,
        showFlag,
      })
    );
    const kv = createMemoryKv();
    const message = testMessage({ id: 'job_1' });

    await worker.queue(testBatch('jobs', [message]), { QUEUE_FLAGS: kv });

    expect(message.ackCount).toBe(1);
    expect(await kv.get('queue/job_1')).toBe('done');
  });
});
