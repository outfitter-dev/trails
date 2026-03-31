import { describe, expect, test } from 'bun:test';

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
import { createTracksLayer } from '../tracks-layer.js';

const stubCtx: TrailContext = createTrailContext({
  requestId: 'test-tracks',
  signal: AbortSignal.timeout(5000),
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
    const layer = createTracksLayer(sink);
    const wrapped = layer.wrap(echoTrail, echoTrail.run);

    const result = await wrapped({ value: 'hello' }, stubCtx);

    expect(result.isOk()).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.status).toBe('ok');
  });

  test('records status err on failure', async () => {
    const sink = createMemorySink();
    const layer = createTracksLayer(sink);
    const wrapped = layer.wrap(failTrail, failTrail.run);

    const result = await wrapped({}, stubCtx);

    expect(result.isErr()).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.status).toBe('err');
  });

  test('captures timing (endedAt > startedAt)', async () => {
    const sink = createMemorySink();
    const layer = createTracksLayer(sink);
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
    const layer = createTracksLayer(sink);
    const wrapped = layer.wrap(echoTrail, echoTrail.run);

    await wrapped({ value: 'hello' }, stubCtx);

    const [record] = sink.records;
    expect(record?.trailId).toBe('echo');
    expect(record?.intent).toBe('read');
  });

  test('writes to the provided sink', async () => {
    const sink = createMemorySink();
    const layer = createTracksLayer(sink);
    const wrapped = layer.wrap(echoTrail, echoTrail.run);

    await wrapped({ value: 'a' }, stubCtx);
    await wrapped({ value: 'b' }, stubCtx);

    expect(sink.records).toHaveLength(2);
    expect(sink.records[0]?.id).not.toBe(sink.records[1]?.id);
  });

  test('captures the invoking surface from ctx.extensions', async () => {
    const sink = createMemorySink();
    const layer = createTracksLayer(sink);
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

  test('records thrown implementations as err results', async () => {
    const sink = createMemorySink();
    const throwingTrail = trail('throwing', {
      input: z.object({}),
      output: z.object({ value: z.string() }),
      run: () => {
        throw new Error('explode');
      },
    });

    const layer = createTracksLayer(sink);
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

    const layer = createTracksLayer(sink);
    const wrapped = layer.wrap(cancelledTrail, cancelledTrail.run);
    const result = await wrapped({}, stubCtx);

    expect(result.isErr()).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.status).toBe('cancelled');
    expect(sink.records[0]?.errorCategory).toBe('cancelled');
  });
});
