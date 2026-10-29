import { expect, test } from 'bun:test';

import * as api from '@ontrails/queue';
import type {
  QueueMessage,
  QueueProducer,
  QueueProducerResource,
} from '@ontrails/queue';

test('public exports keep producer resources distinct from consumer activation', () => {
  expect(Object.keys(api).toSorted()).toEqual([
    'createQueueMock',
    'queueBatchSchema',
    'queueBodySchema',
    'queueMessageSchema',
    'queueProducer',
    'queueSendOptionsSchema',
  ]);
  const definition: QueueProducerResource = api.queueProducer('jobs');
  const client: QueueProducer = api.createQueueMock();
  const message: QueueMessage = { body: null, delaySeconds: 0 };
  expect(definition.role).toBe('queue');
  expect(typeof client.sendBatch).toBe('function');
  expect(api.queueMessageSchema.safeParse(message).success).toBe(true);
});

test('runtime root bundles for Workers without Bun test imports', async () => {
  const built = await Bun.build({
    entrypoints: [new URL('../index.ts', import.meta.url).pathname],
    format: 'esm',
    target: 'browser',
  });
  expect(built.success).toBe(true);
  const content = await built.outputs[0]?.text();
  expect(content).toBeDefined();
  expect(content).not.toContain('bun:test');
});
