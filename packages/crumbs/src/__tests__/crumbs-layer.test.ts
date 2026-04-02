import { afterEach, describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  CancelledError,
  Result,
  SURFACE_KEY,
  createTrailContext,
  trail,
} from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';

import { createMemorySink } from '../memory-sink.js';
import { getTraceContext, TRACE_CONTEXT_KEY } from '../trace-context.js';
import type { TraceContext } from '../trace-context.js';
import { crumbs } from '../index.js';
import { createCrumbsLayer } from '../crumbs-layer.js';

const stubCtx: TrailContext = createTrailContext({
  abortSignal: AbortSignal.timeout(5000),
  requestId: 'test-crumbs',
});

const echoTrail = trail('echo', {
  input: z.object({ value: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string() }),
  run: (input) => Result.ok({ value: input.value }),
});

const failTrail = trail('fail', {
  input: z.object({}),
  output: z.object({ value: z.string() }),
  run: () => Result.err(new Error('boom')),
});

// oxlint-disable max-statements -- integration tests with setup + assertions
describe('tracksLayer', () => {
  test('records a successful trail execution', async () => {
    const sink = createMemorySink();
    const layer = createCrumbsLayer(sink);
    const wrapped = layer.wrap(echoTrail, echoTrail.run);

    const result = await wrapped({ value: 'hello' }, stubCtx);

    expect(result.isOk()).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.status).toBe('ok');
  });

  test('records status err on failure', async () => {
    const sink = createMemorySink();
    const layer = createCrumbsLayer(sink);
    const wrapped = layer.wrap(failTrail, failTrail.run);

    const result = await wrapped({}, stubCtx);

    expect(result.isErr()).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.status).toBe('err');
  });

  test('captures timing (endedAt > startedAt)', async () => {
    const sink = createMemorySink();
    const layer = createCrumbsLayer(sink);
    const wrapped = layer.wrap(echoTrail, echoTrail.run);

    await wrapped({ value: 'hello' }, stubCtx);

    expect(sink.records).toHaveLength(1);
    const [record] = sink.records;
    expect(record?.endedAt).toBeNumber();
    expect(record?.startedAt).toBeNumber();
    expect(Number(record?.endedAt)).toBeGreaterThanOrEqual(
      Number(record?.startedAt)
    );
  });

  test('records trailId and intent from the trail', async () => {
    const sink = createMemorySink();
    const layer = createCrumbsLayer(sink);
    const wrapped = layer.wrap(echoTrail, echoTrail.run);

    await wrapped({ value: 'hello' }, stubCtx);

    const [record] = sink.records;
    expect(record?.trailId).toBe('echo');
    expect(record?.intent).toBe('read');
  });

  test('writes to the provided sink', async () => {
    const sink = createMemorySink();
    const layer = createCrumbsLayer(sink);
    const wrapped = layer.wrap(echoTrail, echoTrail.run);

    await wrapped({ value: 'a' }, stubCtx);
    await wrapped({ value: 'b' }, stubCtx);

    expect(sink.records).toHaveLength(2);
    expect(sink.records[0]?.id).not.toBe(sink.records[1]?.id);
  });

  describe('trace context propagation', () => {
    test('creates root trace context for root invocations', async () => {
      const sink = createMemorySink();
      const layer = createCrumbsLayer(sink);
      const wrapped = layer.wrap(echoTrail, echoTrail.run);

      await wrapped({ value: 'hello' }, stubCtx);

      const [record] = sink.records;
      expect(record?.traceId).toBeString();
      expect(record?.traceId.length).toBeGreaterThan(0);
    });

    test('injects trace context into ctx.extensions for child trails', async () => {
      let capturedTrace: TraceContext | undefined;
      const capturingTrail = trail('capture', {
        input: z.object({}),
        output: z.object({}),
        run: (_input, ctx) => {
          capturedTrace = getTraceContext(ctx as TrailContext);
          return Result.ok({});
        },
      });

      const sink = createMemorySink();
      const layer = createCrumbsLayer(sink);
      const wrapped = layer.wrap(capturingTrail, capturingTrail.run);

      await wrapped({}, stubCtx);

      expect(capturedTrace).toBeDefined();
      expect(capturedTrace?.traceId).toBeString();
      expect(capturedTrace?.spanId).toBeString();
      expect(capturedTrace?.sampled).toBe(true);
    });

    test('child invocation inherits parent traceId and links to parent record id', async () => {
      const sink = createMemorySink();
      const layer = createCrumbsLayer(sink);

      const childTrail = trail('child', {
        input: z.object({}),
        output: z.object({}),
        run: () => Result.ok({}),
      });

      let capturedTrace: TraceContext | undefined;
      const rootTrail = trail('root', {
        input: z.object({}),
        output: z.object({}),
        run: (_input, ctx) => {
          capturedTrace = getTraceContext(ctx as TrailContext);
          return Result.ok({});
        },
      });

      const wrappedRoot = layer.wrap(rootTrail, rootTrail.run);
      await wrappedRoot({}, stubCtx);

      const ctxWithTrace: TrailContext = {
        ...stubCtx,
        extensions: {
          ...stubCtx.extensions,
          [TRACE_CONTEXT_KEY]: capturedTrace,
        },
      };

      const wrappedChild = layer.wrap(childTrail, childTrail.run);
      await wrappedChild({}, ctxWithTrace);

      const [rootRecord, childRecord] = sink.records;
      expect(childRecord?.traceId).toBe(rootRecord?.traceId);
      expect(childRecord?.parentId).toBe(rootRecord?.id);
      expect(childRecord?.rootId).toBe(rootRecord?.id);
    });
  });

  describe('permit capture', () => {
    test('captures permit from ctx when present', async () => {
      const sink = createMemorySink();
      const layer = createCrumbsLayer(sink);
      const wrapped = layer.wrap(echoTrail, echoTrail.run);

      const ctxWithPermit: TrailContext = {
        ...stubCtx,
        permit: { id: 'permit-1', tenantId: 'tenant-abc' },
      };

      await wrapped({ value: 'hello' }, ctxWithPermit);

      expect(sink.records[0]?.permit).toEqual({
        id: 'permit-1',
        tenantId: 'tenant-abc',
      });
    });
  });

  describe('surface capture', () => {
    test('captures the invoking surface from ctx.extensions', async () => {
      const sink = createMemorySink();
      const layer = createCrumbsLayer(sink);
      const wrapped = layer.wrap(echoTrail, echoTrail.run);

      const ctxWithSurface: TrailContext = {
        ...stubCtx,
        extensions: {
          ...stubCtx.extensions,
          [SURFACE_KEY]: 'http',
        },
      };

      await wrapped({ value: 'hello' }, ctxWithSurface);

      expect(sink.records[0]?.surface).toBe('http');
    });
  });

  test('keeps trail result delivery when onSinkError throws', async () => {
    const layer = createCrumbsLayer(
      {
        write: async () => {
          await Promise.resolve();
          throw new Error('sink down');
        },
      },
      {
        onSinkError: () => {
          throw new Error('observer down');
        },
      }
    );
    const wrapped = layer.wrap(echoTrail, echoTrail.run);

    const result = await wrapped({ value: 'hello' }, stubCtx);

    expect(result.isOk()).toBe(true);
  });

  describe('sampling', () => {
    const originalRandom = Math.random;

    afterEach(() => {
      Math.random = originalRandom;
    });

    test('sampled-out read trails are NOT written to sink', async () => {
      Math.random = () => 0.99;
      const sink = createMemorySink();
      const layer = createCrumbsLayer(sink, { sampling: { read: 0.05 } });
      const wrapped = layer.wrap(echoTrail, echoTrail.run);

      const result = await wrapped({ value: 'hello' }, stubCtx);

      expect(result.isOk()).toBe(true);
      expect(sink.records).toHaveLength(0);
    });

    test('error promotion writes sampled-out failing trails', async () => {
      Math.random = () => 0.99;
      const sink = createMemorySink();
      const layer = createCrumbsLayer(sink, {
        keepOnError: true,
        sampling: { read: 0.05 },
      });

      const readFailTrail = trail('read-fail', {
        input: z.object({}),
        intent: 'read',
        output: z.object({ value: z.string() }),
        run: () => Result.err(new Error('boom')),
      });

      const wrapped = layer.wrap(readFailTrail, readFailTrail.run);
      const result = await wrapped({}, stubCtx);

      expect(result.isErr()).toBe(true);
      expect(sink.records).toHaveLength(1);
      expect(sink.records[0]?.status).toBe('err');
    });

    test('empty sampling config preserves record-everything default', async () => {
      Math.random = () => 0.99;
      const sink = createMemorySink();
      const layer = createCrumbsLayer(sink, { sampling: {} });
      const wrapped = layer.wrap(echoTrail, echoTrail.run);

      await wrapped({ value: 'hello' }, stubCtx);

      expect(sink.records).toHaveLength(1);
    });
  });

  test('records thrown implementations as err results', async () => {
    const sink = createMemorySink();
    const throwingTrail = trail('throwing', {
      input: z.object({}),
      output: z.object({ value: z.string() }),
      run: () => {
        throw new Error('explode');
      },
    });

    const layer = createCrumbsLayer(sink);
    const wrapped = layer.wrap(throwingTrail, throwingTrail.run);
    const result = await wrapped({}, stubCtx);

    expect(result.isErr()).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.status).toBe('err');
    expect(sink.records[0]?.errorCategory).toBe('internal');
  });

  test('maps cancelled errors to cancelled status and category', async () => {
    const sink = createMemorySink();
    const cancelledTrail = trail('cancelled', {
      input: z.object({}),
      output: z.object({ value: z.string() }),
      run: () => Result.err(new CancelledError('stop')),
    });

    const layer = createCrumbsLayer(sink);
    const wrapped = layer.wrap(cancelledTrail, cancelledTrail.run);
    const result = await wrapped({}, stubCtx);

    expect(result.isErr()).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.status).toBe('cancelled');
    expect(sink.records[0]?.errorCategory).toBe('cancelled');
  });

  test('injects crumbs.from(ctx).span so manual spans become child records', async () => {
    const sink = createMemorySink();
    const instrumentedTrail = trail('instrumented', {
      input: z.object({}),
      output: z.object({ value: z.string() }),
      run: async (_input, ctx) => {
        const value = await crumbs
          .from(ctx as TrailContext)
          .span('inner-span', () => 'done');
        return Result.ok({ value });
      },
    });

    const layer = createCrumbsLayer(sink);
    const wrapped = layer.wrap(instrumentedTrail, instrumentedTrail.run);

    const result = await wrapped({}, stubCtx);

    expect(result.isOk()).toBe(true);
    expect(sink.records).toHaveLength(2);

    const trailRecord = sink.records.find((record) => record.kind === 'trail');
    const spanRecord = sink.records.find((record) => record.kind === 'span');

    expect(trailRecord?.trailId).toBe('instrumented');
    expect(spanRecord?.name).toBe('inner-span');
    expect(spanRecord?.parentId).toBe(trailRecord?.id);
    expect(spanRecord?.rootId).toBe(trailRecord?.id);
    expect(spanRecord?.traceId).toBe(trailRecord?.traceId);
  });

  test('merges crumbs.from(ctx).annotate attrs into the trail record', async () => {
    const sink = createMemorySink();
    const annotatedTrail = trail('annotated', {
      input: z.object({}),
      output: z.object({ value: z.string() }),
      run: (_input, ctx) => {
        crumbs.from(ctx as TrailContext).annotate({ count: 1, stage: 'start' });
        crumbs.from(ctx as TrailContext).annotate({ count: 2, detail: 'done' });
        return Result.ok({ value: 'ok' });
      },
    });

    const layer = createCrumbsLayer(sink);
    const wrapped = layer.wrap(annotatedTrail, annotatedTrail.run);

    const result = await wrapped({}, stubCtx);

    expect(result.isOk()).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.attrs).toEqual({
      count: 2,
      detail: 'done',
      stage: 'start',
    });
  });
});
