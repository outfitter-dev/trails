import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { ValidationError } from '../errors.js';
import { queue, validateQueueSource } from '../queue.js';

describe('queue()', () => {
  test('returns frozen inert queue source data', () => {
    const source = queue('queue.email.outbox', {
      meta: { owner: 'email' },
      parse: z.object({ messageId: z.string() }),
      queue: ' email-outbox ',
    });

    expect(source).toMatchObject({
      id: 'queue.email.outbox',
      kind: 'queue',
      meta: { owner: 'email' },
      queue: 'email-outbox',
    });
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.meta)).toBe(true);
  });

  test('defaults the runtime queue name to the source id', () => {
    const source = queue({
      id: 'queue.audit.events',
      parse: z.object({ eventId: z.string() }),
    });

    expect(source.queue).toBe('queue.audit.events');
  });

  test('rejects missing parse and empty queue names', () => {
    expect(() =>
      queue('queue.invalid', {
        parse: z.object({}),
        queue: ' ',
      })
    ).toThrow(ValidationError);

    expect(() =>
      queue('queue.invalid', {
        // oxlint-disable-next-line no-explicit-any -- intentionally malformed source spec.
        parse: undefined as any,
      })
    ).toThrow('parse');
  });

  test('validates manually-authored queue source shape', () => {
    expect(
      validateQueueSource({
        id: 'queue.invalid',
        kind: 'queue',
        queue: '',
      })
    ).toEqual([
      {
        field: 'queue',
        message: 'Queue source must define a non-empty queue name',
      },
      {
        field: 'parse',
        message: 'Queue sources must define parse',
      },
    ]);
  });
});
