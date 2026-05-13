import { describe, expect, test } from 'bun:test';

import { resource, Result, topo, trail, webhook } from '@ontrails/core';
import { z } from 'zod';

import { createHttpHarness } from '../harness-http.js';

describe('createHttpHarness', () => {
  test('executes read trails through query input', async () => {
    const show = trail('entity.show', {
      blaze: (input: { name: string }) =>
        Result.ok({ greeting: `Hello, ${input.name}!` }),
      input: z.object({ name: z.string() }),
      intent: 'read',
      output: z.object({ greeting: z.string() }),
    });
    const harness = createHttpHarness({
      graph: topo('test-app', { show }),
    });

    const result = await harness.get('/entity/show', { name: 'Trails' });

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ greeting: 'Hello, Trails!' });
    expect(result.body).toEqual({ data: { greeting: 'Hello, Trails!' } });
  });

  test('executes write trails through body input', async () => {
    const create = trail('entity.create', {
      blaze: (input: { name: string }) => Result.ok({ id: '1', ...input }),
      input: z.object({ name: z.string() }),
      intent: 'write',
      output: z.object({ id: z.string(), name: z.string() }),
    });
    const harness = createHttpHarness({
      graph: topo('test-app', { create }),
    });

    const result = await harness.post('/entity/create', { name: 'Alpha' });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: '1', name: 'Alpha' });
  });

  test('does not treat non-webhook body input as a parse Result', async () => {
    const create = trail('entity.create', {
      blaze: (input: { isErr: boolean; name: string }) => Result.ok(input),
      input: z.object({ isErr: z.boolean(), name: z.string() }),
      intent: 'write',
      output: z.object({ isErr: z.boolean(), name: z.string() }),
    });
    const harness = createHttpHarness({
      graph: topo('test-app', { create }),
    });

    const result = await harness.post('/entity/create', {
      isErr: false,
      name: 'Alpha',
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ isErr: false, name: 'Alpha' });
  });

  test('executes PATCH webhook routes through the convenience helper', async () => {
    const source = webhook('webhook.payment.received', {
      method: 'PATCH',
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
    });
    const receiver = trail('payment.receive', {
      blaze: (input: { paymentId: string }) => Result.ok(input),
      input: z.object({ paymentId: z.string() }),
      on: [source],
      output: z.object({ paymentId: z.string() }),
    });
    const harness = createHttpHarness({
      graph: topo('test-app', { receiver }),
    });

    const result = await harness.patch('/webhooks/payment', {
      paymentId: 'pay_1',
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ paymentId: 'pay_1' });
  });

  test('maps validation errors to the HTTP error envelope', async () => {
    const show = trail('entity.show', {
      blaze: (input: { name: string }) => Result.ok({ name: input.name }),
      input: z.object({ name: z.string() }),
      intent: 'read',
      output: z.object({ name: z.string() }),
    });
    const harness = createHttpHarness({
      graph: topo('test-app', { show }),
    });

    const result = await harness.get('/entity/show');

    expect(result.status).toBe(400);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ValidationError');
  });

  test('threads resource overrides through HTTP projection options', async () => {
    const dbResource = resource('db.main', {
      create: () => Result.ok({ source: 'factory' }),
    });
    const readResource = trail('resource.read', {
      blaze: (_input, ctx) =>
        Result.ok({ source: dbResource.from(ctx).source as string }),
      input: z.object({}),
      intent: 'read',
      output: z.object({ source: z.string() }),
      resources: [dbResource],
    });
    const harness = createHttpHarness({
      graph: topo('test-app', { dbResource, readResource }),
      resources: {
        'db.main': { source: 'override' },
      },
    });

    const result = await harness.get('/resource/read');

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ source: 'override' });
  });
});
