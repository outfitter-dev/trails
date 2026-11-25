import { test } from 'bun:test';
import type { QueueBody, QueueMessage } from '@ontrails/queue';
import { createQueueContractCases } from '@ontrails/queue/testing';
import { Miniflare } from 'miniflare';

import { createCloudflareQueueBinding } from '../index.js';
import type {
  CloudflareQueueSendOptions,
  CloudflareQueueSendRequest,
} from '../index.js';

// Miniflare's Node proxy rejects own __proto__ data before native Queues sees it.
// JSON requests reach the real Worker binding without narrowing the role domain.
const nativeWorker = `
const accepted = [];
let attempts = 0;
const record = (body, delaySeconds) => accepted.push({body, ...(delaySeconds === undefined ? {} : {delaySeconds})});
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/state') return Response.json({attempts, accepted});
    const input = await request.json();
    try {
      if (path === '/send') {
        attempts += 1;
        await env.JOBS.send(input.body, input.options);
        record(input.body, input.options.delaySeconds);
      } else {
        attempts += 1;
        await env.JOBS.sendBatch(input.messages);
        for (const entry of input.messages) record(entry.body, entry.delaySeconds);
      }
      return new Response(null, {status:204});
    } catch { return new Response('Native queue submission failed', {status:500}); }
  },
  queue(batch) { batch.ackAll(); }
};`;

for (const example of createQueueContractCases({
  createSubject: async () => {
    const runtime = new Miniflare({
      compatibilityDate: '2026-06-01',
      modules: true,
      queueConsumers: { jobs: { maxBatchSize: 1 } },
      queueProducers: { JOBS: 'jobs' },
      script: nativeWorker,
    });
    try {
      await runtime.ready;
      const invoke = async (path: string, input: unknown): Promise<void> => {
        const response = await runtime.dispatchFetch(
          `http://localhost/${path}`,
          {
            body: JSON.stringify(input),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          }
        );
        if (!response.ok) {
          throw new Error(await response.text());
        }
      };
      const state = async (): Promise<{
        attempts: number;
        accepted: QueueMessage[];
      }> => {
        const response = await runtime.dispatchFetch('http://localhost/state');
        return response.json() as Promise<{
          attempts: number;
          accepted: QueueMessage[];
        }>;
      };
      const client = createCloudflareQueueBinding({
        send: (body: QueueBody, options: CloudflareQueueSendOptions) =>
          invoke('send', { body, options }),
        sendBatch: (
          messages: Iterable<CloudflareQueueSendRequest<QueueBody>>
        ) => invoke('batch', { messages: [...messages] }),
      });
      return {
        attempts: async () => {
          const observed = await state();
          return observed.attempts;
        },
        client,
        dispose: () => runtime.dispose(),
        observe: async () => {
          const observed = await state();
          return observed.accepted;
        },
      };
    } catch (error) {
      await runtime.dispose();
      throw error;
    }
  },
})) {
  test(`native Cloudflare ${example.name}`, example.check, 30_000);
}
