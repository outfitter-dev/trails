import { expect } from 'bun:test';
import { TrailsError } from '@ontrails/core';

import type { QueueBody, QueueMessage } from './schemas.js';
import type { QueueProducer } from './types.js';

/**
 * An isolated producer and fixture observation of accepted submissions.
 * Provider fixtures must call the actual binding before recording acceptance;
 * observation alone is not evidence of consumer processing or real delay timing.
 */
export interface QueueContractSubject {
  readonly client: QueueProducer;
  /**
   * Count native provider calls before initiation, including calls that reject.
   * Memory-only fixtures count recorded submissions instead: they perform no I/O.
   */
  readonly attempts: () => number | Promise<number>;
  readonly observe: () =>
    | readonly QueueMessage[]
    | Promise<readonly QueueMessage[]>;
  readonly dispose?: (() => void | Promise<void>) | undefined;
}

/** Provider fixtures own isolation and observation; no account is provisioned. */
export interface QueueContractOptions {
  readonly createSubject: () =>
    | QueueContractSubject
    | Promise<QueueContractSubject>;
}

/** One shared case for the caller's test runner and timeout policy. */
export interface QueueContractCase {
  readonly name: string;
  readonly check: () => Promise<void>;
}

const invalidBodies = (): readonly unknown[] => {
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  return [
    Object.defineProperty({}, '__proto__', {
      enumerable: true,
      value: undefined,
    }),
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    new Date(),
    new Uint8Array([1]),
    { missing: undefined },
    { toJSON: () => 'coerced' },
    cyclic,
  ];
};

/**
 * Run identical producer cases against the memory recorder and real bindings.
 * Fixtures observe accepted bodies/options, not delivery guarantees. Provider
 * integration must separately prove delivery through core consumer parse and
 * existing acknowledgement/retry mapping.
 *
 * @example
 * ```ts
 * for (const example of createQueueContractCases({ createSubject })) {
 *   test(example.name, example.check);
 * }
 * ```
 */
export const createQueueContractCases = (
  options: QueueContractOptions
): readonly QueueContractCase[] => {
  const using = (
    name: string,
    check: (subject: QueueContractSubject) => Promise<void>
  ): QueueContractCase => ({
    check: async () => {
      const subject = await options.createSubject();
      try {
        await check(subject);
      } finally {
        await subject.dispose?.();
      }
    },
    name,
  });
  return [
    using(
      'Queue accepts JSON objects, arrays, primitives, and null',
      async ({ client, observe }) => {
        const bodies: QueueBody[] = [
          JSON.parse('{"__proto__":{"id":"job"},"constructor":2}'),
          { nested: ['x', 1, true, null] },
          [1, 'two'],
          'text',
          42,
          false,
          null,
        ];
        for (const body of bodies) {
          await client.send(body);
        }
        const observed = await observe();
        expect(observed).toEqual(bodies.map((body) => ({ body })));
        const proto = Object.getOwnPropertyDescriptor(
          observed[0]?.body ?? {},
          '__proto__'
        );
        expect(proto?.value).toEqual({ id: 'job' });
      }
    ),
    using(
      'Queue snapshots bodies and requested delays',
      async ({ client, observe }) => {
        const body = { nested: { id: 'original' } };
        const sendOptions = { delaySeconds: 0 };
        await client.send(body, sendOptions);
        body.nested.id = 'changed';
        sendOptions.delaySeconds = 9;
        await client.send('default');
        await client.send('later', { delaySeconds: 2 });
        expect(await observe()).toEqual([
          { body: { nested: { id: 'original' } }, delaySeconds: 0 },
          { body: 'default' },
          { body: 'later', delaySeconds: 2 },
        ]);
      }
    ),
    using(
      'Queue batch snapshots all entries before acceptance',
      async ({ client, observe }) => {
        const body = { id: 'original' };
        const messages = [
          { body },
          { body: null, delaySeconds: 0 },
          { body: 'later', delaySeconds: 2 },
        ];
        await client.sendBatch(messages);
        body.id = 'changed';
        messages[1] = { body: 'changed', delaySeconds: 8 };
        expect(await observe()).toEqual([
          { body: { id: 'original' } },
          { body: null, delaySeconds: 0 },
          { body: 'later', delaySeconds: 2 },
        ]);
      }
    ),
    using(
      'Queue empty batch is a no-op',
      async ({ attempts, client, observe }) => {
        await client.sendBatch([]);
        expect(await observe()).toEqual([]);
        expect(await attempts()).toBe(0);
      }
    ),
    using(
      'Queue rejects nonportable bodies without acceptance',
      async ({ attempts, client, observe }) => {
        for (const body of invalidBodies()) {
          await expect(client.send(body as QueueBody)).rejects.toBeInstanceOf(
            TrailsError
          );
        }
        expect(await observe()).toEqual([]);
        expect(await attempts()).toBe(0);
        await client.send('valid probe');
        expect(await attempts()).toBeGreaterThan(0);
      }
    ),
    using(
      'Queue validates complete batches and delays before acceptance',
      async ({ attempts, client, observe }) => {
        for (const delaySeconds of [
          -1,
          0.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
        ]) {
          await expect(
            client.send('body', { delaySeconds })
          ).rejects.toBeInstanceOf(TrailsError);
          await expect(
            client.sendBatch([
              { body: 'valid' },
              { body: 'invalid', delaySeconds },
            ])
          ).rejects.toBeInstanceOf(TrailsError);
        }
        await expect(
          client.sendBatch([
            { body: 'valid' },
            { body: undefined as unknown as QueueBody },
          ])
        ).rejects.toBeInstanceOf(TrailsError);
        expect(await observe()).toEqual([]);
        expect(await attempts()).toBe(0);
        await client.sendBatch([{ body: 'valid probe' }]);
        expect(await attempts()).toBeGreaterThan(0);
      }
    ),
  ];
};
