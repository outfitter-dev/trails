import { describe, expect, mock, test } from 'bun:test';

import {
  AuthError,
  InternalError,
  LAYER_INPUTS_KEY,
  NotFoundError,
  PermitError,
  Result,
  SURFACE_KEY,
  clearTraceSink,
  getActivationProvenance,
  resource,
  registerTraceSink,
  signal,
  ValidationError,
  trail,
  topo,
  webhook,
} from '@ontrails/core';
import type {
  ActivationSource,
  Layer,
  TraceRecord,
  TraceSink,
  TrailContext,
} from '@ontrails/core';
import { z } from 'zod';

import { deriveHttpRoutes } from '../build.js';

const createCapturingSink = (records: TraceRecord[]): TraceSink => ({
  write(record) {
    records.push(record);
  },
});

const findTraceRecord = (
  records: readonly TraceRecord[],
  predicate: (record: TraceRecord) => boolean,
  label: string
): TraceRecord => {
  const record = records.find(predicate);
  if (record === undefined) {
    throw new Error(`Expected ${label} trace record`);
  }
  return record;
};

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  description: 'Echo a message back',
  implementation: (input) => Result.ok({ reply: input.message }),
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const createTrail = trail('item.create', {
  description: 'Create an item',
  implementation: (input) => Result.ok({ id: '123', name: input.name }),
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const deleteTrail = trail('item.delete', {
  description: 'Delete an item',
  implementation: (_input) => Result.ok({ deleted: true }),
  input: z.object({ id: z.string() }),
  intent: 'destroy',
});

const notFoundTrail = trail('item.get', {
  description: 'Get an item that does not exist',
  implementation: (_input) => Result.err(new NotFoundError('Item not found')),
  input: z.object({ id: z.string() }),
  intent: 'read',
});

const internalTrail = trail('crash', {
  description: 'Always fails with internal error',
  implementation: () => Result.err(new InternalError('Something broke')),
  input: z.object({}),
});

const internalVisibilityTrail = trail('secret', {
  description: 'Internal trail that should be skipped',
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  visibility: 'internal',
});

const dbResource = resource('db.main', {
  create: () =>
    Result.ok({
      source: 'factory',
    }),
});

const orderPlaced = signal('order.placed', {
  payload: z.object({ orderId: z.string() }),
});

const requireFire = (fire: TrailContext['fire']) => {
  if (!fire) {
    throw new Error('Expected ctx.fire to be bound');
  }
  return fire;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveHttpRoutes', () => {
  describe('method derivation', () => {
    test('intent: read maps to GET', () => {
      const app = topo('testapp', { echoTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe('GET');
    });

    test('intent: destroy maps to DELETE', () => {
      const app = topo('testapp', { deleteTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe('DELETE');
    });

    test('default intent (write) maps to POST', () => {
      const app = topo('testapp', { createTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe('POST');
    });
  });

  describe('path derivation', () => {
    test('dotted ID becomes slashed path', () => {
      const app = topo('testapp', { createTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value[0]?.path).toBe('/item/create');
    });

    test('simple ID becomes /id', () => {
      const app = topo('testapp', { echoTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value[0]?.path).toBe('/echo');
    });

    test('basePath is prepended', () => {
      const app = topo('testapp', { echoTrail });
      const result = deriveHttpRoutes(app, { basePath: '/api/v1' });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value[0]?.path).toBe('/api/v1/echo');
    });

    test('basePath trailing slash is normalized', () => {
      const app = topo('testapp', { echoTrail });
      const result = deriveHttpRoutes(app, { basePath: '/api/v1/' });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value[0]?.path).toBe('/api/v1/echo');
    });
  });

  describe('input source derivation', () => {
    test('GET routes use query input source', () => {
      const app = topo('testapp', { echoTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value[0]?.inputSource).toBe('query');
    });

    test('POST routes use body input source', () => {
      const app = topo('testapp', { createTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value[0]?.inputSource).toBe('body');
    });

    test('DELETE routes use body input source', () => {
      const app = topo('testapp', { deleteTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value[0]?.inputSource).toBe('body');
    });
  });

  describe('filtering', () => {
    test('internal trails are skipped', () => {
      const app = topo('testapp', { echoTrail, internalVisibilityTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.trailId).toBe('echo');
    });

    test('exact include can expose an internal trail', () => {
      const app = topo('testapp', { echoTrail, internalVisibilityTrail });
      const result = deriveHttpRoutes(app, { include: ['secret'] });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.trailId).toBe('secret');
    });

    test('wildcard include does not expose internal trails', () => {
      const app = topo('testapp', { echoTrail, internalVisibilityTrail });
      const result = deriveHttpRoutes(app, { include: ['**'] });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.trailId).toBe('echo');
    });

    test('exclude patterns win before include narrowing', () => {
      const app = topo('testapp', { deleteTrail, echoTrail });
      const result = deriveHttpRoutes(app, {
        exclude: ['item.**'],
        include: ['echo', 'item.delete'],
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value.map((route) => route.trailId)).toEqual(['echo']);
    });

    test('intent filters narrow the route table', () => {
      const app = topo('testapp', { deleteTrail, echoTrail });
      const result = deriveHttpRoutes(app, { intent: ['read'] });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value.map((route) => route.trailId)).toEqual(['echo']);
    });

    test('intent filters compose with include patterns using AND logic', () => {
      const app = topo('testapp', { deleteTrail, echoTrail });
      const result = deriveHttpRoutes(app, {
        include: ['item.*', 'echo'],
        intent: ['destroy'],
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value.map((route) => route.trailId)).toEqual([
        'item.delete',
      ]);
    });

    test('consumer trails (on: [...]) are skipped', () => {
      const consumerTrail = trail('notify.email', {
        description: 'Send email on order placed',
        implementation: (input: { orderId: string }) =>
          Result.ok({ delivered: true, orderId: input.orderId }),
        input: z.object({ orderId: z.string() }),
        on: ['order.placed'],
      });
      const app = topo('testapp', { consumerTrail, echoTrail, orderPlaced });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const routes = result.value;
      expect(routes).toHaveLength(1);
      expect(routes[0]?.trailId).toBe('echo');
    });
  });

  describe('webhook source materialization', () => {
    test('materializes webhook activation sources as HTTP routes', () => {
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      const receiver = trail('payment.receive', {
        implementation: (input) => Result.ok({ paymentId: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ paymentId: z.string() }),
      });

      const result = deriveHttpRoutes(topo('billing', { receiver }));

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        inputSource: 'webhook',
        method: 'POST',
        path: '/webhooks/payment',
        trailId: 'payment.receive',
        webhookSource: source,
      });
    });

    test('fans out shared webhook source routes to every consumer trail', async () => {
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      const invoked: string[] = [];
      const audit = trail('payment.audit', {
        implementation: (input) => {
          invoked.push(`audit:${input.paymentId}`);
          return Result.ok({ audited: input.paymentId });
        },
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ audited: z.string() }),
      });
      const notify = trail('payment.notify', {
        implementation: (input) => {
          invoked.push(`notify:${input.paymentId}`);
          return Result.ok({ notified: input.paymentId });
        },
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ notified: z.string() }),
      });

      const result = deriveHttpRoutes(topo('billing', { audit, notify }));

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value).toHaveLength(1);
      const [route] = result.value;
      const parsed = route?.parseWebhookInput?.({ paymentId: 'pay_1' });
      expect(parsed?.isOk()).toBe(true);
      if (!parsed?.isOk()) {
        return;
      }
      const executed = await route?.execute(parsed.value);
      expect(executed?.isOk()).toBe(true);
      if (!executed?.isOk()) {
        return;
      }
      expect(executed.value).toEqual([
        { audited: 'pay_1' },
        { notified: 'pay_1' },
      ]);
      expect(invoked).toEqual(['audit:pay_1', 'notify:pay_1']);
    });

    test('webhook execution partitions typed layer input and composes route layers', async () => {
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      const captured: unknown[] = [];
      const auditLayer: Layer = {
        input: z.object({ auditMode: z.string() }),
        name: 'audit',
        wrap(_trail, impl) {
          return async (input, ctx) => {
            const all = ctx.extensions?.[LAYER_INPUTS_KEY] as
              | Record<string, unknown>
              | undefined;
            captured.push(all?.['audit']);
            return await impl(input, ctx);
          };
        },
      };
      let observedInput: unknown;
      const receiver = trail('payment.receive', {
        implementation: (input) => {
          observedInput = input;
          return Result.ok({ paymentId: input.paymentId });
        },
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ paymentId: z.string() }),
      });

      const result = deriveHttpRoutes(topo('billing', { receiver }), {
        layers: [auditLayer],
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const [route] = result.value;
      const executed = await route?.execute({
        auditMode: 'full',
        paymentId: 'pay_1',
      });

      expect(executed?.isOk()).toBe(true);
      expect(observedInput).toEqual({ paymentId: 'pay_1' });
      expect(captured).toEqual([{ auditMode: 'full' }]);
    });

    test('merged webhook consumers share one activation fire ID per inbound request', async () => {
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      const fireIds: (string | undefined)[] = [];
      const rootFireIds: (string | undefined)[] = [];
      const sourceIds: (string | undefined)[] = [];
      const audit = trail('payment.audit', {
        implementation: (input, ctx) => {
          const activation = getActivationProvenance(ctx);
          fireIds.push(activation?.fireId);
          rootFireIds.push(activation?.rootFireId);
          sourceIds.push(activation?.source.id);
          return Result.ok({ audited: input.paymentId });
        },
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ audited: z.string() }),
      });
      const notify = trail('payment.notify', {
        implementation: (input, ctx) => {
          const activation = getActivationProvenance(ctx);
          fireIds.push(activation?.fireId);
          rootFireIds.push(activation?.rootFireId);
          sourceIds.push(activation?.source.id);
          return Result.ok({ notified: input.paymentId });
        },
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ notified: z.string() }),
      });

      let nextId = 0;
      const randomUUID = mock(() => {
        nextId += 1;
        return `00000000-0000-4000-8000-00000000000${nextId}`;
      });
      const originalRandomUUID = globalThis.crypto.randomUUID;
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        configurable: true,
        value: randomUUID,
      });

      try {
        const result = deriveHttpRoutes(topo('billing', { audit, notify }));
        expect(result.isOk()).toBe(true);
        if (!result.isOk()) {
          return;
        }
        const [route] = result.value;
        const parsed = route?.parseWebhookInput?.({ paymentId: 'pay_1' });
        expect(parsed?.isOk()).toBe(true);
        if (!parsed?.isOk()) {
          return;
        }
        const executed = await route?.execute(parsed.value);
        expect(executed?.isOk()).toBe(true);

        expect(fireIds).toHaveLength(2);
        expect(fireIds[0]).toBeDefined();
        expect(fireIds[0]).toBe(fireIds[1]);
        expect(rootFireIds[0]).toBe(fireIds[0]);
        expect(rootFireIds[1]).toBe(fireIds[1]);
        expect(sourceIds).toEqual([
          'webhook.payment.received',
          'webhook.payment.received',
        ]);
        // Exactly one activation fire ID is generated per inbound request,
        // regardless of how many consumers fan out from it.
        expect(randomUUID).toHaveBeenCalledTimes(1);
      } finally {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          configurable: true,
          value: originalRandomUUID,
        });
      }
    });

    test('prepends basePath to webhook source paths', () => {
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      const receiver = trail('payment.receive', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({ paymentId: z.string() }),
        on: [source],
      });

      const result = deriveHttpRoutes(topo('billing', { receiver }), {
        basePath: '/api',
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value[0]?.path).toBe('/api/webhooks/payment');
    });

    test('canonicalizes manual webhook source methods and paths', () => {
      const source: ActivationSource = {
        id: 'webhook.payment.received',
        kind: 'webhook',
        method: 'post',
        parse: z.object({ paymentId: z.string() }),
        path: ' /webhooks/payment ',
      };
      const receiver = trail('payment.receive', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({ paymentId: z.string() }),
        on: [source],
      });

      const result = deriveHttpRoutes(topo('billing', { receiver }));

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value[0]?.method).toBe('POST');
      expect(result.value[0]?.path).toBe('/webhooks/payment');
      expect(result.value[0]?.webhookSource).toMatchObject({
        method: 'POST',
        path: '/webhooks/payment',
      });
    });

    test('parses webhook payloads before executing the consumer trail', async () => {
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      let activationSourceId: string | undefined;
      let activationFireId: string | undefined;
      const receiver = trail('payment.receive', {
        implementation: (input, ctx) => {
          const activation = getActivationProvenance(ctx);
          activationSourceId = activation?.source.id;
          activationFireId = activation?.fireId;
          return Result.ok({ paymentId: input.paymentId });
        },
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ paymentId: z.string() }),
      });
      const randomUUID = mock(() => '00000000-0000-4000-8000-000000000000');
      const originalRandomUUID = globalThis.crypto.randomUUID;
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        configurable: true,
        value: randomUUID,
      });

      try {
        const result = deriveHttpRoutes(topo('billing', { receiver }));

        expect(result.isOk()).toBe(true);
        if (!result.isOk()) {
          return;
        }
        const [route] = result.value;
        const parsed = route?.parseWebhookInput?.({ paymentId: 'pay_1' });
        expect(parsed?.isOk()).toBe(true);
        if (!parsed?.isOk()) {
          return;
        }

        const executed = await route?.execute(parsed.value);
        expect(executed?.isOk()).toBe(true);
        if (!executed?.isOk()) {
          return;
        }
        expect(executed.value).toEqual({ paymentId: 'pay_1' });
        expect(activationSourceId).toBe('webhook.payment.received');
        expect(activationFireId).toBe('00000000-0000-4000-8000-000000000000');
        expect(randomUUID).toHaveBeenCalledTimes(1);
      } finally {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          configurable: true,
          value: originalRandomUUID,
        });
      }
    });

    test('webhook where guards skip execution when they return false', async () => {
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      let invoked = 0;
      const receiver = trail('payment.receive', {
        implementation: (input) => {
          invoked += 1;
          return Result.ok({ paymentId: input.paymentId });
        },
        input: z.object({ paymentId: z.string() }),
        on: [{ source, where: () => false }],
        output: z.object({ paymentId: z.string() }),
      });
      const result = deriveHttpRoutes(topo('billing', { receiver }));

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      const [route] = result.value;
      const parsed = route?.parseWebhookInput?.({ paymentId: 'pay_1' });
      expect(parsed?.isOk()).toBe(true);
      if (!parsed?.isOk()) {
        return;
      }

      const executed = await route?.execute(parsed.value);

      expect(executed?.isOk()).toBe(true);
      if (!executed?.isOk()) {
        return;
      }
      expect(executed.value).toBeUndefined();
      expect(invoked).toBe(0);
    });

    test('webhook execution emits an activation trace record parented to the receiver', async () => {
      const records: TraceRecord[] = [];
      const source: ActivationSource = {
        id: 'webhook.payment.received',
        kind: 'webhook',
        method: 'post',
        parse: z.object({ paymentId: z.string() }),
        path: ' /webhooks/payment ',
      };
      const receiver = trail('payment.receive', {
        implementation: (input) => Result.ok({ paymentId: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ paymentId: z.string() }),
      });
      const result = deriveHttpRoutes(topo('billing', { receiver }));
      registerTraceSink(createCapturingSink(records));

      try {
        expect(result.isOk()).toBe(true);
        if (!result.isOk()) {
          return;
        }
        const [route] = result.value;
        const parsed = route?.parseWebhookInput?.({ paymentId: 'pay_1' });
        expect(parsed?.isOk()).toBe(true);
        if (!parsed?.isOk()) {
          return;
        }

        const executed = await route?.execute(parsed.value);

        expect(executed?.isOk()).toBe(true);
        const activation = findTraceRecord(
          records,
          (entry) =>
            entry.kind === 'activation' && entry.name === 'activation.webhook',
          'activation.webhook'
        );
        const trailRecord = findTraceRecord(
          records,
          (entry) =>
            entry.kind === 'trail' && entry.trailId === 'payment.receive',
          'payment.receive'
        );
        expect(trailRecord.parentId).toBe(activation.id);
        expect(trailRecord.traceId).toBe(activation.traceId);
        expect(trailRecord.rootId).toBe(activation.rootId);
        expect(activation.attrs).toMatchObject({
          'trails.activation.source.id': 'webhook.payment.received',
          'trails.activation.source.kind': 'webhook',
          'trails.activation.target_trail.id': 'payment.receive',
          'trails.activation.webhook.method': 'POST',
          'trails.activation.webhook.path': '/webhooks/payment',
        });
        expect(trailRecord.attrs['trails.activation.fire_id']).toBe(
          activation.attrs['trails.activation.fire_id']
        );
      } finally {
        clearTraceSink();
      }
    });

    test('webhook parse failures emit invalid activation trace records', async () => {
      const records: TraceRecord[] = [];
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      const receiver = trail('payment.receive', {
        implementation: (input) => Result.ok({ paymentId: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ paymentId: z.string() }),
      });
      const result = deriveHttpRoutes(topo('billing', { receiver }));
      registerTraceSink(createCapturingSink(records));

      try {
        expect(result.isOk()).toBe(true);
        if (!result.isOk()) {
          return;
        }
        const [route] = result.value;
        const parsed = route?.parseWebhookInput?.({});

        expect(parsed?.isErr()).toBe(true);
        await route?.recordWebhookInvalid?.();
        const invalid = findTraceRecord(
          records,
          (entry) =>
            entry.kind === 'activation' &&
            entry.name === 'activation.webhook.invalid',
          'activation.webhook.invalid'
        );
        expect(invalid.status).toBe('err');
        expect(invalid.errorCategory).toBe('validation');
        expect(invalid.attrs).toMatchObject({
          'trails.activation.source.id': 'webhook.payment.received',
          'trails.activation.source.kind': 'webhook',
          'trails.activation.target_trail.id': 'payment.receive',
          'trails.activation.webhook.method': 'POST',
          'trails.activation.webhook.path': '/webhooks/payment',
        });
      } finally {
        clearTraceSink();
      }
    });

    test('rejects webhook routes that collide with derived trail routes', () => {
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      const receiver = trail('payment.receive', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({ paymentId: z.string() }),
        on: [source],
      });
      const direct = trail('webhooks.payment', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
      });

      const result = deriveHttpRoutes(topo('billing', { direct, receiver }));

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('POST /webhooks/payment');
    });

    test('rejects shared webhook routes with mismatched verifier policies', () => {
      const verifyA = mock(() => Promise.resolve(Result.ok()));
      const verifyB = mock(() => Promise.resolve(Result.ok()));
      const sourceA = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
        verify: verifyA,
      });
      const sourceB = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
        verify: verifyB,
      });
      const audit = trail('payment.audit', {
        implementation: (input) => Result.ok({ audited: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [sourceA],
        output: z.object({ audited: z.string() }),
      });
      const notify = trail('payment.notify', {
        implementation: (input) => Result.ok({ notified: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [sourceB],
        output: z.object({ notified: z.string() }),
      });

      // PR #348 tightened the upstream validator to reject mismatched
      // verifier policies; bypass it here so we exercise the HTTP-level
      // merge guard directly.
      const result = deriveHttpRoutes(topo('billing', { audit, notify }), {
        validate: false,
      });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('webhook verifier policy');
      expect(result.error.message).toContain('POST /webhooks/payment');
    });

    test('merges shared webhook routes when verifier and parse identities match', () => {
      const verify = mock(() => Promise.resolve(Result.ok()));
      const parse = z.object({ paymentId: z.string() });
      const sourceA = webhook('webhook.payment.received', {
        parse,
        path: '/webhooks/payment',
        verify,
      });
      const sourceB = webhook('webhook.payment.received', {
        parse,
        path: '/webhooks/payment',
        verify,
      });
      const audit = trail('payment.audit', {
        implementation: (input) => Result.ok({ audited: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [sourceA],
        output: z.object({ audited: z.string() }),
      });
      const notify = trail('payment.notify', {
        implementation: (input) => Result.ok({ notified: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [sourceB],
        output: z.object({ notified: z.string() }),
      });

      const result = deriveHttpRoutes(topo('billing', { audit, notify }), {
        validate: false,
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value).toHaveLength(1);
    });

    test('rejects shared webhook routes with mismatched parse contracts', () => {
      const verify = mock(() => Promise.resolve(Result.ok()));
      const sourceA = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
        verify,
      });
      const sourceB = webhook('webhook.payment.received', {
        parse: z.object({ amount: z.number(), paymentId: z.string() }),
        path: '/webhooks/payment',
        verify,
      });
      const audit = trail('payment.audit', {
        implementation: (input) => Result.ok({ audited: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [sourceA],
        output: z.object({ audited: z.string() }),
      });
      const notify = trail('payment.notify', {
        implementation: (input) => Result.ok({ notified: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [sourceB],
        output: z.object({ notified: z.string() }),
      });

      // The upstream `activation-source-definition-unique` validator rejects
      // mismatched parse contracts, so bypass it here to exercise the
      // HTTP-level merge guard directly.
      const result = deriveHttpRoutes(topo('billing', { audit, notify }), {
        validate: false,
      });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('webhook parse contract');
      expect(result.error.message).toContain('POST /webhooks/payment');
    });

    test('records an invalid activation trace for every merged consumer', async () => {
      const records: TraceRecord[] = [];
      const verify = mock(() => Promise.resolve(Result.ok()));
      const parse = z.object({ paymentId: z.string() });
      const sourceA = webhook('webhook.payment.received', {
        parse,
        path: '/webhooks/payment',
        verify,
      });
      const sourceB = webhook('webhook.payment.received', {
        parse,
        path: '/webhooks/payment',
        verify,
      });
      const audit = trail('payment.audit', {
        implementation: (input) => Result.ok({ audited: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [sourceA],
        output: z.object({ audited: z.string() }),
      });
      const notify = trail('payment.notify', {
        implementation: (input) => Result.ok({ notified: input.paymentId }),
        input: z.object({ paymentId: z.string() }),
        on: [sourceB],
        output: z.object({ notified: z.string() }),
      });

      const built = deriveHttpRoutes(topo('billing', { audit, notify }), {
        validate: false,
      });
      expect(built.isOk()).toBe(true);
      if (!built.isOk()) {
        return;
      }
      expect(built.value).toHaveLength(1);
      const [route] = built.value;

      registerTraceSink(createCapturingSink(records));
      try {
        await route?.recordWebhookInvalid?.('validation');

        const invalids = records.filter(
          (entry) =>
            entry.kind === 'activation' &&
            entry.name === 'activation.webhook.invalid'
        );
        // Two consumers share the source -> two invalid records, one per
        // consumer. Neither receiver may be silently dropped from telemetry.
        expect(invalids).toHaveLength(2);
        const targets = invalids
          .map(
            (entry) =>
              entry.attrs['trails.activation.target_trail.id'] as string
          )
          .toSorted();
        expect(targets).toEqual(['payment.audit', 'payment.notify']);
        for (const invalid of invalids) {
          expect(invalid.status).toBe('err');
          expect(invalid.errorCategory).toBe('validation');
        }
        // Sibling invalid records from a single failed inbound request must
        // share one activation fire ID so observability can correlate them
        // as one activation root, mirroring the success path.
        const fireIds = invalids.map(
          (entry) => entry.attrs['trails.activation.fire_id']
        );
        expect(fireIds).toHaveLength(2);
        expect(fireIds[0]).toBeString();
        expect(fireIds[0]).toBe(fireIds[1]);
      } finally {
        clearTraceSink();
      }
    });

    test('runs every fan-out consumer even when an earlier consumer fails', async () => {
      const source = webhook('webhook.payment.received', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      });
      const invoked: string[] = [];
      const failing = trail('payment.audit', {
        implementation: (input) => {
          invoked.push(`audit:${input.paymentId}`);
          return Result.err(new ValidationError('audit blew up'));
        },
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ audited: z.string() }),
      });
      const succeeding = trail('payment.notify', {
        implementation: (input) => {
          invoked.push(`notify:${input.paymentId}`);
          return Result.ok({ notified: input.paymentId });
        },
        input: z.object({ paymentId: z.string() }),
        on: [source],
        output: z.object({ notified: z.string() }),
      });

      const built = deriveHttpRoutes(topo('billing', { failing, succeeding }));
      expect(built.isOk()).toBe(true);
      if (!built.isOk()) {
        return;
      }
      const [route] = built.value;
      const parsed = route?.parseWebhookInput?.({ paymentId: 'pay_1' });
      expect(parsed?.isOk()).toBe(true);
      if (!parsed?.isOk()) {
        return;
      }

      const executed = await route?.execute(parsed.value);

      // Every consumer attempted, regardless of order or earlier failures.
      expect(invoked).toEqual(['audit:pay_1', 'notify:pay_1']);
      // First error surfaces; later successes do not mask it.
      expect(executed?.isErr()).toBe(true);
      if (!executed?.isErr()) {
        return;
      }
      expect(executed.error.message).toContain('audit blew up');
    });
  });

  describe('route definition shape', () => {
    test('includes trail reference', () => {
      const app = topo('testapp', { echoTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(Object.is(result.value[0]?.trail, echoTrail)).toBe(true);
    });

    test('execute is a function', () => {
      const app = topo('testapp', { echoTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(typeof result.value[0]?.execute).toBe('function');
    });
  });

  describe('execute', () => {
    test('returns ok Result on valid input', async () => {
      const app = topo('testapp', { echoTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({ message: 'hello' });
      expect(result?.isOk()).toBe(true);
      if (!result?.isOk()) {
        return;
      }
      expect(result.value).toEqual({ reply: 'hello' });
    });

    test('projects live versions and executes selected request version', async () => {
      const versioned = trail('versioned.greet', {
        implementation: (input: { name: string }) =>
          Result.ok({ message: `Hello, ${input.name}!` }),
        input: z.object({ name: z.string() }),
        output: z.object({ message: z.string() }),
        version: 3,
        versions: {
          1: {
            input: z.object({ firstName: z.string(), legacyId: z.string() }),
            output: z.object({ message: z.string() }),
            status: { state: 'archived' },
            transpose: {
              input: ({ input }: { input: { firstName: string } }) => ({
                name: input.firstName,
              }),
              output: ({ output }) => output,
            },
          },
          2: {
            input: z.object({ firstName: z.string() }),
            output: z.object({ message: z.string() }),
            status: { note: 'Use name.', state: 'deprecated' },
            transpose: {
              input: ({ input }: { input: { firstName: string } }) => ({
                name: input.firstName,
              }),
              output: ({ output }) => output,
            },
          },
        },
      });
      const buildResult = deriveHttpRoutes(topo('testapp', { versioned }));

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      expect(route?.inputSchema).toMatchObject({
        properties: {
          trailVersion: { type: 'string' },
        },
      });
      expect(route?.versions?.map((entry) => entry.version)).toEqual([2, 3]);

      const result = await route?.execute({
        firstName: 'Ada',
        trailVersion: '2',
      });

      expect(result?.isOk()).toBe(true);
      if (!result?.isOk()) {
        return;
      }
      expect(result.value).toEqual({ message: 'Hello, Ada!' });
    });

    test('ignores version headers on unversioned routes', async () => {
      const app = topo('testapp', { echoTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;
      expect(route?.versions).toBeUndefined();
      expect(
        route === undefined ? false : Object.hasOwn(route, 'versions')
      ).toBe(false);

      const result = await route?.execute(
        { message: 'hello' },
        undefined,
        undefined,
        { headers: { 'x-trails-version': '2' } }
      );

      expect(result?.isOk()).toBe(true);
      if (!result?.isOk()) {
        return;
      }
      expect(result.value).toEqual({ reply: 'hello' });
    });

    test('returns err Result on invalid input', async () => {
      const app = topo('testapp', { echoTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isErr()).toBe(true);
    });

    test('returns err Result from trail error', async () => {
      const app = topo('testapp', { notFoundTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({ id: 'missing' });
      expect(result?.isErr()).toBe(true);
      if (!result?.isErr()) {
        return;
      }
      expect(result.error.message).toBe('Item not found');
    });

    test('returns err Result from internal error', async () => {
      const app = topo('testapp', { internalTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isErr()).toBe(true);
      if (!result?.isErr()) {
        return;
      }
      expect(result.error.message).toBe('Something broke');
    });

    test('returns err Result when implementation throws', async () => {
      const throwingTrail = trail('throwing', {
        implementation: () => {
          throw new Error('unexpected throw');
        },
        input: z.object({}),
      });
      const app = topo('testapp', { throwingTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isErr()).toBe(true);
      if (!result?.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toBe('unexpected throw');
    });

    test('returns err Result when createContext throws', async () => {
      const app = topo('testapp', { echoTrail });
      const buildResult = deriveHttpRoutes(app, {
        createContext: () => {
          throw new Error('context creation failed');
        },
      });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({ message: 'hi' });
      expect(result?.isErr()).toBe(true);
      if (!result?.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toBe('context creation failed');
    });

    test('passes topo to executeTrail so HTTP-invoked producers can fan out', async () => {
      const captured: string[] = [];
      const consumer = trail('notify.email', {
        implementation: (input: { orderId: string }) => {
          captured.push(input.orderId);
          return Result.ok({ delivered: true });
        },
        input: z.object({ orderId: z.string() }),
        on: ['order.placed'],
      });
      const producer = trail('order.create', {
        fires: [orderPlaced],
        implementation: async (input: { orderId: string }, ctx) => {
          await requireFire(ctx.fire)(orderPlaced, {
            orderId: input.orderId,
          });
          return Result.ok({ ok: true });
        },
        input: z.object({ orderId: z.string() }),
      });
      const app = topo('signal-http', { consumer, orderPlaced, producer });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({ orderId: 'o-http' });

      expect(result?.isOk()).toBe(true);
      expect(captured).toEqual(['o-http']);
    });

    test('passes requestId to context', async () => {
      let capturedRequestId: string | undefined;

      const ctxTrail = trail('ctx.check', {
        implementation: (_input, ctx) => {
          capturedRequestId = ctx.requestId;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        intent: 'read',
      });

      const app = topo('testapp', { ctxTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      await route?.execute({}, 'custom-req-123');
      expect(capturedRequestId).toBe('custom-req-123');
    });

    test('uses default requestId when none provided', async () => {
      let capturedRequestId: string | undefined;

      const ctxTrail = trail('ctx.default', {
        implementation: (_input, ctx) => {
          capturedRequestId = ctx.requestId;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        intent: 'read',
      });

      const app = topo('testapp', { ctxTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      await route?.execute({});
      expect(capturedRequestId).toBeDefined();
      expect(capturedRequestId).not.toBe('');
    });

    test('forwards resource overrides into executeTrail', async () => {
      const resourceTrail = trail('resource.check', {
        implementation: (_input, ctx) =>
          Result.ok({ source: dbResource.from(ctx).source as string }),
        input: z.object({}),
        output: z.object({ source: z.string() }),
        resources: [dbResource],
      });

      const app = topo('testapp', { dbResource, resourceTrail });
      const buildResult = deriveHttpRoutes(app, {
        resources: { 'db.main': { source: 'override' } },
      });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isOk()).toBe(true);
      if (!result?.isOk()) {
        return;
      }
      expect(result.value).toEqual({ source: 'override' });
    });

    test('resolves Authorization Bearer credentials into ctx.permit', async () => {
      let observedPermit: TrailContext['permit'];
      const protectedTrail = trail('permit.read', {
        implementation: (_input, ctx) => {
          observedPermit = ctx.permit;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        intent: 'read',
        output: z.object({ ok: z.boolean() }),
        permit: { scopes: ['thing:read'] },
      });
      const app = topo('permit-http', { protectedTrail });
      const buildResult = deriveHttpRoutes(app, {
        resolvePermit: ({ bearerToken }) =>
          Result.ok(
            bearerToken === 'good'
              ? { id: 'user-1', scopes: ['thing:read'] }
              : { id: 'user-1', scopes: [] }
          ),
      });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;
      const result = await route?.execute({}, 'req-1', undefined, {
        headers: { authorization: 'Bearer good' },
      });

      expect(result?.isOk()).toBe(true);
      expect(observedPermit).toEqual({ id: 'user-1', scopes: ['thing:read'] });
    });

    test('missing Authorization on a protected route falls through to PermitError', async () => {
      const protectedTrail = trail('permit.missing', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
        intent: 'read',
        permit: { scopes: ['thing:read'] },
      });
      const app = topo('permit-http', { protectedTrail });
      const buildResult = deriveHttpRoutes(app, {
        resolvePermit: () =>
          Result.ok({ id: 'user-1', scopes: ['thing:read'] }),
      });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;
      const result = await route?.execute({});

      expect(result?.isErr()).toBe(true);
      if (!result?.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(PermitError);
    });

    test('Bearer Authorization without a resolver falls through for public routes', async () => {
      const app = topo('permit-http', { echoTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;
      const result = await route?.execute(
        { message: 'hello' },
        'req-1',
        undefined,
        {
          headers: { authorization: 'Bearer gateway-token' },
        }
      );

      expect(result?.isOk()).toBe(true);
      if (result?.isOk()) {
        expect(result.value).toEqual({ reply: 'hello' });
      }
    });

    test('non-Bearer Authorization on public routes is ignored before permit resolution', async () => {
      let resolveCalled = false;
      const app = topo('permit-http', { echoTrail });
      const buildResult = deriveHttpRoutes(app, {
        resolvePermit: () => {
          resolveCalled = true;
          return Result.ok({ id: 'user-1', scopes: [] });
        },
      });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;
      const result = await route?.execute(
        { message: 'hello' },
        'req-1',
        undefined,
        {
          headers: { authorization: 'Basic dXNlcjpwYXNz' },
        }
      );

      expect(result?.isOk()).toBe(true);
      if (result?.isOk()) {
        expect(result.value).toEqual({ reply: 'hello' });
      }
      expect(resolveCalled).toBe(false);
    });

    test('Bearer Authorization without a resolver still lets protected routes fail at the permit gate', async () => {
      const protectedTrail = trail('permit.no-resolver', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
        intent: 'read',
        permit: { scopes: ['thing:read'] },
      });
      const app = topo('permit-http', { protectedTrail });
      const buildResult = deriveHttpRoutes(app);

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;
      const result = await route?.execute({}, 'req-1', undefined, {
        headers: { authorization: 'Bearer gateway-token' },
      });

      expect(result?.isErr()).toBe(true);
      if (result?.isErr()) {
        expect(result.error).toBeInstanceOf(PermitError);
      }
    });

    test('malformed Authorization header fails before execution', async () => {
      let invoked = false;
      const protectedTrail = trail('permit.malformed', {
        implementation: () => {
          invoked = true;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        intent: 'read',
        permit: { scopes: ['thing:read'] },
      });
      const app = topo('permit-http', { protectedTrail });
      const buildResult = deriveHttpRoutes(app, {
        resolvePermit: () =>
          Result.ok({ id: 'user-1', scopes: ['thing:read'] }),
      });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;
      const result = await route?.execute({}, 'req-1', undefined, {
        headers: { authorization: 'Basic nope' },
      });

      expect(result?.isErr()).toBe(true);
      if (!result?.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(AuthError);
      expect(invoked).toBe(false);
    });

    test('resolved permit with missing scopes returns PermitError', async () => {
      const protectedTrail = trail('permit.scope', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
        intent: 'read',
        permit: { scopes: ['thing:read'] },
      });
      const app = topo('permit-http', { protectedTrail });
      const buildResult = deriveHttpRoutes(app, {
        resolvePermit: () => Result.ok({ id: 'user-1', scopes: [] }),
      });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;
      const result = await route?.execute({}, 'req-1', undefined, {
        headers: { authorization: 'Bearer weak' },
      });

      expect(result?.isErr()).toBe(true);
      if (!result?.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(PermitError);
    });
  });

  describe('layers', () => {
    test('layers compose around trail execution', async () => {
      const calls: string[] = [];

      const testGate: Layer = {
        name: 'test-layer',
        wrap(_trail, impl) {
          return async (input, ctx) => {
            calls.push('before');
            const result = await impl(input, ctx);
            calls.push('after');
            return result;
          };
        },
      };

      const app = topo('testapp', { echoTrail });
      const buildResult = deriveHttpRoutes(app, { layers: [testGate] });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({ message: 'hi' });
      expect(result?.isOk()).toBe(true);
      expect(calls).toEqual(['before', 'after']);
    });

    test('topo, surface, and trail layers compose in documented order', async () => {
      const calls: string[] = [];
      const makeLayer = (name: string): Layer => ({
        name,
        wrap(_trail, impl) {
          return async (input, ctx) => {
            calls.push(`${name}:before`);
            const result = await impl(input, ctx);
            calls.push(`${name}:after`);
            return result;
          };
        },
      });

      const trailLayer = makeLayer('trail');
      const surfaceLayer = makeLayer('surface');
      const topoLayer = makeLayer('topo');
      const layeredTrail = trail('layered.echo', {
        implementation: (input) => {
          calls.push('implementation');
          return Result.ok({ reply: input.message });
        },
        input: z.object({ message: z.string() }),
        layers: [trailLayer],
        output: z.object({ reply: z.string() }),
      });
      const app = topo('testapp', { layeredTrail }, { layers: [topoLayer] });
      const buildResult = deriveHttpRoutes(app, { layers: [surfaceLayer] });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({ message: 'hi' });
      expect(result?.isOk()).toBe(true);
      expect(calls).toEqual([
        'topo:before',
        'surface:before',
        'trail:before',
        'implementation',
        'trail:after',
        'surface:after',
        'topo:after',
      ]);
    });
  });

  describe('custom createContext', () => {
    test('custom createContext is used when provided', async () => {
      const contextState = { custom: false, surfaceMarker: false };

      const ctxTrail = trail('ctx.custom', {
        implementation: (_input, ctx) => {
          contextState.custom = ctx.extensions?.['custom'] === true;
          contextState.surfaceMarker = ctx.extensions?.[SURFACE_KEY] === 'http';
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        intent: 'read',
      });

      const app = topo('testapp', { ctxTrail });
      const buildResult = deriveHttpRoutes(app, {
        createContext: () => ({
          abortSignal: new AbortController().signal,
          extensions: { custom: true },
          requestId: 'test-id',
        }),
      });

      expect(buildResult.isOk()).toBe(true);
      if (!buildResult.isOk()) {
        return;
      }
      const [route] = buildResult.value;

      const result = await route?.execute({});
      expect(result?.isOk()).toBe(true);
      expect(contextState.custom).toBe(true);
      expect(contextState.surfaceMarker).toBe(true);
    });
  });

  describe('collision detection', () => {
    test('returns err on duplicate (path, method) pair', () => {
      // "entity.show" derives path /entity/show (dots become slashes)
      // "entity/show" derives path /entity/show (slashes are preserved)
      // Both have intent: read -> GET, so they collide on GET /entity/show
      const dotTrail = trail('entity.show', {
        description: 'Show entity (dot notation)',
        implementation: () => Result.ok({ dot: true }),
        input: z.object({}),
        intent: 'read',
      });
      const slashTrail = trail('entity/show', {
        description: 'Show entity (slash notation)',
        implementation: () => Result.ok({ slash: true }),
        input: z.object({}),
        intent: 'read',
      });
      const app = topo('testapp', { dotTrail, slashTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('GET /entity/show');
    });

    test('same path with different methods is allowed', () => {
      // "item.resource" derives GET /item/resource (intent: read)
      // "item/resource" derives POST /item/resource (default intent: write)
      // Same path, different methods — no collision
      const getItem = trail('item.resource', {
        description: 'Get item',
        implementation: () => Result.ok({ get: true }),
        input: z.object({}),
        intent: 'read',
      });
      const createItem = trail('item/resource', {
        description: 'Create item',
        implementation: () => Result.ok({ created: true }),
        input: z.object({ name: z.string() }),
      });
      const app = topo('testapp', { createItem, getItem });
      const result = deriveHttpRoutes(app);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) {
        return;
      }
      expect(result.value).toHaveLength(2);
    });

    test('collision error message identifies both trail IDs', () => {
      const dotTrail = trail('entity.show', {
        description: 'Trail one',
        implementation: () => Result.ok({ one: true }),
        input: z.object({}),
        intent: 'read',
      });
      const slashTrail = trail('entity/show', {
        description: 'Trail two',
        implementation: () => Result.ok({ two: true }),
        input: z.object({}),
        intent: 'read',
      });
      const app = topo('testapp', { dotTrail, slashTrail });
      const result = deriveHttpRoutes(app);

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error.message).toContain('entity');
    });
  });

  describe('established graph enforcement', () => {
    test('returns err when draft contamination remains', () => {
      const draftTrail = trail('entity.export', {
        composes: ['_draft.entity.prepare'],
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
      });

      const result = deriveHttpRoutes(topo('testapp', { draftTrail }));

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) {
        return;
      }
      expect(result.error.message).toMatch(/draft/i);
    });
  });
});
