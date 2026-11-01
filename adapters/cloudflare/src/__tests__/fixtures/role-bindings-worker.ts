import {
  InternalError,
  NotFoundError,
  Result,
  blobRefSchema,
  isTrailsError,
  queue,
  topo,
  trail,
} from '@ontrails/core';
import { blob, blobInfoSchema } from '@ontrails/blob';
import { kv } from '@ontrails/kv';
import { queueProducer } from '@ontrails/queue';
import { createCloudflareKvBinding } from '@ontrails/cloudflare/kv';
import { createCloudflareBlobBinding } from '@ontrails/cloudflare/r2';
import { createCloudflareQueueBinding } from '@ontrails/cloudflare/queues';
import { createWorkersHandler } from '@ontrails/cloudflare/workers';
import { z } from 'zod';

const flags = kv('flags');
const files = blob('files');
const jobs = queueProducer('jobs');
const failures = queueProducer('failures');
const failingProducer = queueProducer('failing-producer');
const failed = (error: unknown) =>
  Result.err(
    isTrailsError(error)
      ? error
      : new InternalError('Unexpected fixture failure', {
          cause:
            error instanceof Error
              ? error
              : new Error('Non-Error fixture failure'),
        })
  );
const flagWrite = trail('flag.write', {
  implementation: async (input, ctx) => {
    try {
      await flags.from(ctx).put(input.key, input.value);
      return Result.ok({ stored: true });
    } catch (error) {
      return failed(error);
    }
  },
  input: z.object({ key: z.string(), value: z.string() }),
  output: z.object({ stored: z.boolean() }),
  resources: [flags],
});
const flagRead = trail('flag.read', {
  implementation: async (input, ctx) => {
    try {
      return Result.ok({ value: await flags.from(ctx).get(input.key) });
    } catch (error) {
      return failed(error);
    }
  },
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
  resources: [flags],
});
const fileWrite = trail('file.write', {
  implementation: async (input, ctx) => {
    const data = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.enqueue(new Uint8Array([3]));
        c.close();
      },
    });
    try {
      return Result.ok(
        await files
          .from(ctx)
          .put(input.key, data, { mimeType: 'application/x-test' })
      );
    } catch (error) {
      return failed(error);
    }
  },
  input: z.object({ key: z.string() }),
  output: blobInfoSchema,
  resources: [files],
});
const fileRead = trail('file.read', {
  implementation: async (input, ctx) => {
    try {
      const value = await files.from(ctx).get(input.key);
      return value === null
        ? Result.err(new NotFoundError('Missing fixture file'))
        : Result.ok(value);
    } catch (error) {
      return failed(error);
    }
  },
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: blobRefSchema,
  resources: [files],
});
const jobSubmit = trail('job.submit', {
  implementation: async (input, ctx) => {
    try {
      await jobs.from(ctx).send(input, { delaySeconds: 0 });
      return Result.ok({ accepted: true });
    } catch (error) {
      return failed(error);
    }
  },
  input: z.object({ count: z.string() }),
  output: z.object({ accepted: z.boolean() }),
  resources: [jobs],
});
const jobConsume = trail('job.consume', {
  implementation: async (input, ctx) => {
    try {
      await flags.from(ctx).put('received', String(input.count + 1));
      return Result.ok({ stored: true });
    } catch (error) {
      return failed(error);
    }
  },
  input: z.object({ count: z.number() }),
  on: [
    queue('queue.jobs', {
      parse: z.object({ count: z.coerce.number() }),
      queue: 'jobs',
    }),
  ],
  output: z.object({ stored: z.boolean() }),
  resources: [flags],
});
const failureSubmit = trail('failure.submit', {
  implementation: async (input, ctx) => {
    try {
      await failures.from(ctx).send(input);
      return Result.ok({ accepted: true });
    } catch (error) {
      return failed(error);
    }
  },
  input: z.object({ id: z.string() }),
  output: z.object({ accepted: z.boolean() }),
  resources: [failures],
});
const failureForward = trail('failure.forward', {
  implementation: async (input, ctx) => {
    try {
      await failingProducer.from(ctx).send(input);
      return Result.ok({ accepted: true });
    } catch (error) {
      return failed(error);
    }
  },
  input: z.object({ id: z.string() }),
  output: z.object({ accepted: z.boolean() }),
  resources: [failingProducer],
  visibility: 'internal',
});
const failureConsume = trail('failure.consume', {
  composes: [failureForward],
  implementation: async (input, ctx) => {
    try {
      const client = flags.from(ctx);
      const attempts = Number((await client.get('failure-attempts')) ?? 0) + 1;
      await client.put('failure-attempts', String(attempts));
      return ctx.compose(failureForward, input);
    } catch (error) {
      return failed(error);
    }
  },
  input: z.object({ id: z.string() }),
  on: [
    queue('queue.failures', {
      parse: z.object({ id: z.string() }),
      queue: 'failures',
    }),
  ],
  output: z.object({ accepted: z.boolean() }),
  resources: [flags],
});
const graph = topo('role-bindings-worker', {
  failingProducer,
  failureConsume,
  failureForward,
  failureSubmit,
  failures,
  fileRead,
  fileWrite,
  files,
  flagRead,
  flagWrite,
  flags,
  jobConsume,
  jobSubmit,
  jobs,
});

export default createWorkersHandler(graph, {
  resources: (env) => ({
    [flags.id]: createCloudflareKvBinding(env['FLAGS']),
    [files.id]: createCloudflareBlobBinding(env['BUCKET'], {
      maxBufferedBytes: 4,
    }),
    [jobs.id]: createCloudflareQueueBinding(env['JOBS']),
    [failures.id]: createCloudflareQueueBinding(env['FAILURES']),
    // Fault injection at the native dependency boundary, not an alternate retry policy.
    [failingProducer.id]: createCloudflareQueueBinding({
      send: async () => {
        throw new Error('Injected native producer failure');
      },
      sendBatch: async () => {
        throw new Error('Injected native producer failure');
      },
    }),
  }),
});
