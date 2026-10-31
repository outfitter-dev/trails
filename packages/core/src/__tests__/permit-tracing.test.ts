import { afterEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { ValidationError } from '../errors.js';
import { executeTrail } from '../execute.js';
import { Result } from '../result.js';
import { run } from '../run.js';
import { signal } from '../signal.js';
import { topo } from '../topo.js';
import { trail } from '../trail.js';
import {
  clearTraceSink,
  createSignalTraceRecord,
  createSpanRecord,
  createTraceRecord,
  registerTraceSink,
  traceContextFromRecord,
  writeActivationTraceRecord,
} from '../tracing.js';
import type { TraceRecord } from '../tracing.js';

const snapshot = {
  actors: [
    {
      id: 'actor',
      issuer: 'https://actor.example',
      kind: 'agent',
      verified: true,
    },
    { id: 'prior-actor', kind: 'unknown', verified: true },
  ],
  id: 'subject',
  issuer: 'https://issuer.example',
  tenantId: 'tenant',
};
const permit = { ...snapshot, scopes: ['entry:read'] };

afterEach(clearTraceSink);

describe('permit trace evidence', () => {
  test('retains complete identity on a trail and its manual span', async () => {
    const records: TraceRecord[] = [];
    registerTraceSink({
      write: (record) => {
        records.push(record);
      },
    });
    const entry = trail('identity.trace', {
      implementation: async (_input, ctx) =>
        ctx.trace('manual', () => Result.ok({ ok: true })),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['entry:read'] },
    });
    const result = await executeTrail(entry, {}, { permit });
    expect(result.isOk()).toBe(true);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.permit).toEqual(snapshot);
    }
  });

  test('projects actor contract fields without leaking arbitrary adapter data', async () => {
    const records: TraceRecord[] = [];
    registerTraceSink({
      write: (record) => {
        records.push(record);
      },
    });
    const supplied = {
      ...permit,
      actors: permit.actors.map((actor) => ({
        ...actor,
        token: 'must-not-trace',
      })),
    };
    const entry = trail('identity.projection', {
      implementation: () => Result.ok(null),
      input: z.object({}),
      output: z.null(),
    });
    const result = await executeTrail(entry, {}, { permit: supplied });
    expect(result.isOk()).toBe(true);
    expect(records[0]?.permit).toEqual(snapshot);
    expect(JSON.stringify(records)).not.toContain('must-not-trace');
  });

  test('carries known and legacy-unknown identity through trace parent conversions', async () => {
    const parent = traceContextFromRecord(
      createTraceRecord({ permit: snapshot, trailId: 'parent' })
    );
    expect(createSpanRecord(parent, 'manual').permit).toEqual(snapshot);
    expect(createSignalTraceRecord(parent, 'signal.fired').permit).toEqual(
      snapshot
    );
    const records: TraceRecord[] = [];
    registerTraceSink({
      write: (record) => {
        records.push(record);
      },
    });
    const activation = await writeActivationTraceRecord(
      'activation.webhook',
      {},
      'ok',
      undefined,
      parent
    );
    expect(activation?.permit).toEqual(snapshot);
    const parentless = await writeActivationTraceRecord(
      'activation.webhook',
      {}
    );
    expect(parentless?.permit).toBeUndefined();
    const legacy = traceContextFromRecord(
      createTraceRecord({ permit: { id: 'old' }, trailId: 'legacy' })
    );
    expect(createSpanRecord(legacy, 'legacy-child').permit).toEqual({
      id: 'old',
    });
  });

  test('snapshots caller actor evidence instead of retaining a mutable caller array', async () => {
    const records: TraceRecord[] = [];
    registerTraceSink({
      write: (record) => {
        records.push(record);
      },
    });
    const actor = {
      ...snapshot.actors[0],
      id: 'original',
      kind: 'agent',
      verified: true,
    };
    const supplied = { ...permit, actors: [actor] };
    const entry = trail('identity.snapshot', {
      implementation: () => Result.ok(null),
      input: z.object({}),
      output: z.null(),
    });
    const result = await executeTrail(entry, {}, { permit: supplied });
    expect(result.isOk()).toBe(true);
    expect(records).toHaveLength(1);
    actor.id = 'changed';
    expect(records[0]?.permit).toEqual({
      ...snapshot,
      actors: [{ ...actor, id: 'original' }],
    });
  });

  for (const tracing of [false, true]) {
    test(`rejects malformed execution permit evidence with tracing=${tracing}`, async () => {
      if (tracing) {
        registerTraceSink({ write: () => {} });
      }
      let invoked = false;
      const entry = trail('identity.invalid', {
        implementation: () => {
          invoked = true;
          return Result.ok(null);
        },
        input: z.object({}),
        output: z.null(),
      });
      for (const malformed of [
        { id: 'subject', scopes: [] },
        {
          actors: [{ id: 'actor', kind: 'client', verified: 'true' }],
          id: 'subject',
          scopes: [],
        },
      ]) {
        const result = await executeTrail(
          entry,
          {},
          { permit: malformed as never }
        );
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(ValidationError);
          expect(result.error.message).toBe('Invalid execution permit');
        }
      }
      expect(invoked).toBe(false);
    });
  }

  test('retains actor identity through actual signal delivery and consumer execution', async () => {
    const records: TraceRecord[] = [];
    registerTraceSink({
      write: (record) => {
        records.push(record);
      },
    });
    const changed = signal('entry.changed', {
      payload: z.object({ id: z.string() }),
    });
    const consumer = trail('entry.consume', {
      implementation: () => Result.ok(null),
      input: z.object({ id: z.string() }),
      on: ['entry.changed'],
    });
    const producer = trail('entry.produce', {
      fires: ['entry.changed'],
      implementation: async (_input, ctx) => {
        await ctx.fire?.(changed, { id: 'record' });
        return Result.ok(null);
      },
      input: z.object({}),
      intent: 'write',
    });
    const result = await run(
      topo('trace-actors', { changed, consumer, producer }),
      'entry.produce',
      {},
      { ctx: { permit } }
    );
    expect(result.isOk()).toBe(true);
    expect(records.some((record) => record.trailId === 'entry.consume')).toBe(
      true
    );
    expect(records.some((record) => record.kind === 'signal')).toBe(true);
    for (const record of records) {
      expect(record.permit).toEqual(snapshot);
    }
  });
});
