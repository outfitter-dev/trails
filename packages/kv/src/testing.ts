import { expect } from 'bun:test';
import { TrailsError } from '@ontrails/core';

import type { Kv } from './types.js';

/** One isolated binding and its expiry verification clock. */
export interface KvContractSubject {
  readonly client: Kv;
  /** Advance a fake clock or wait for real time; implementations must await expiry. */
  readonly advanceTime: (milliseconds: number) => void | Promise<void>;
  readonly dispose?: (() => void | Promise<void>) | undefined;
}

/** Provider fixtures choose a supported duration rather than inheriting mock limits. */
export interface KvContractOptions {
  readonly createSubject: () => KvContractSubject | Promise<KvContractSubject>;
  /** Defaults to 60 seconds; provider fixtures may choose a larger supported TTL. */
  readonly ttlSeconds?: number | undefined;
}

/** A case for the caller's test runner and timeout policy. */
export interface KvContractCase {
  readonly name: string;
  readonly check: () => Promise<void>;
}

/**
 * Shared KV cases run unchanged against the memory mock and provider bindings.
 * Fixtures create isolated subjects and supply clock/real-expiry control. A real
 * provider may require a timeout longer than its TTL. No account is provisioned.
 *
 * @example
 * ```ts
 * for (const example of createKvContractCases({ createSubject })) {
 *   test(example.name, example.check, 120_000);
 * }
 * ```
 */
export const createKvContractCases = (
  options: KvContractOptions
): readonly KvContractCase[] => {
  const ttlSeconds = options.ttlSeconds ?? 60;
  const using = (
    name: string,
    check: (subject: KvContractSubject) => Promise<void>
  ): KvContractCase => ({
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
      'KV missing, overwrite, and idempotent delete',
      async ({ client }) => {
        expect(await client.get('missing')).toBeNull();
        await client.delete('missing');
        await client.put('key', 'first');
        expect(await client.get('key')).toBe('first');
        await client.put('key', 'second');
        expect(await client.get('key')).toBe('second');
        await client.delete('key');
        expect(await client.get('key')).toBeNull();
      }
    ),
    using(
      'KV prefix pagination follows explicit completion',
      async ({ client }) => {
        await client.put('flag/a', 'a');
        await client.put('flag/b', 'b');
        await client.put('other', 'c');
        const found: string[] = [];
        const cursors = new Set<string>();
        let cursor: string | undefined;
        for (;;) {
          const page = await client.list({
            limit: 1,
            prefix: 'flag/',
            ...(cursor === undefined ? {} : { cursor }),
          });
          expect(page.keys.length).toBeLessThanOrEqual(1);
          found.push(...page.keys);
          if (page.complete) {
            expect(page).not.toHaveProperty('cursor');
            break;
          }
          expect(page.cursor.length).toBeGreaterThan(0);
          expect(cursors.has(page.cursor)).toBe(false);
          cursors.add(page.cursor);
          ({ cursor } = page);
        }
        expect(found.toSorted()).toEqual(['flag/a', 'flag/b']);
      }
    ),
    using(
      'KV expires after the declared TTL',
      async ({ client, advanceTime }) => {
        await client.put('expiring', 'value', { ttlSeconds });
        expect(await client.get('expiring')).toBe('value');
        await advanceTime(ttlSeconds * 1000);
        expect(await client.get('expiring')).toBeNull();
        const page = await client.list();
        expect(page.keys).not.toContain('expiring');
      }
    ),
    using(
      'KV overwrite without a TTL clears the previous expiry',
      async ({ client, advanceTime }) => {
        await client.put('key', 'old', { ttlSeconds });
        await client.put('key', 'new');
        await advanceTime(ttlSeconds * 1000);
        expect(await client.get('key')).toBe('new');
      }
    ),
    using(
      'KV cursors stay scoped to their prefix query and their binding',
      async ({ client }) => {
        await client.put('flag/a', '1');
        await client.put('flag/b', '2');
        await client.put('other/a', '3');
        const page = await client.list({ limit: 1, prefix: 'flag/' });
        if (page.complete) {
          throw new Error('Expected a continuation cursor for flag/');
        }
        // A valid cursor used with another prefix is refused, not reinterpreted.
        await expect(
          client.list({ cursor: page.cursor, prefix: 'other/' })
        ).rejects.toBeInstanceOf(TrailsError);
        // A valid cursor used against an isolated binding is refused too.
        const other = await options.createSubject();
        try {
          await expect(
            other.client.list({ cursor: page.cursor, prefix: 'flag/' })
          ).rejects.toBeInstanceOf(TrailsError);
        } finally {
          await other.dispose?.();
        }
        // The same binding and prefix continue from the cursor.
        const next = await client.list({
          cursor: page.cursor,
          prefix: 'flag/',
        });
        expect(next.keys).toEqual(['flag/b']);
      }
    ),
    using(
      'KV rejects invalid options as typed failures',
      async ({ client }) => {
        await expect(
          client.put('key', 'value', { ttlSeconds: 0 })
        ).rejects.toBeInstanceOf(TrailsError);
        await expect(client.list({ limit: 0 })).rejects.toBeInstanceOf(
          TrailsError
        );
        await expect(client.list({ cursor: '' })).rejects.toBeInstanceOf(
          TrailsError
        );
      }
    ),
  ];
};
