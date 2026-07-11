import { describe, expect, test } from 'bun:test';

import { Result, schedule, signal, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  deriveActivationGraph,
  deriveDeclaredTrailActivation,
  deriveSignalActivationRelations,
} from '../activation-report.js';

const noop = () => Result.ok(null as unknown);

describe('activation report derivation', () => {
  test('derives signal chains and activation sources from the topo', () => {
    const created = signal('user.created', {
      from: ['user.create'],
      payload: z.object({ userId: z.string() }),
    });
    const nightly = schedule('schedule.user.reindex', {
      cron: '0 2 * * *',
      input: { id: 'nightly' },
      timezone: 'UTC',
    });
    const producer = trail('user.create', {
      fires: [created],
      implementation: noop,
      input: z.object({}),
    });
    const consumer = trail('user.index', {
      implementation: noop,
      input: z.object({}),
      on: [created],
    });
    const scheduled = trail('user.scheduled-index', {
      implementation: noop,
      input: z.object({ id: z.string() }),
      on: [nightly],
    });
    const app = topo('activation-report', {
      consumer,
      created,
      producer,
      scheduled,
    });

    const graph = deriveActivationGraph(app);

    expect(graph.overview).toMatchObject({
      chainCount: 1,
      edgeCount: 2,
      sourceCount: 2,
      sourceKeys: ['schedule:schedule.user.reindex', 'signal:user.created'],
      trailIds: ['user.create', 'user.index', 'user.scheduled-index'],
    });
    expect(graph.signals.get('user.created')).toEqual({
      consumers: ['user.index'],
      producers: ['user.create'],
    });
    expect(graph.trails.get('user.index')).toMatchObject({
      activatedBy: ['user.create'],
      fires: [],
      on: ['user.created'],
    });
    expect(graph.trails.get('user.scheduled-index')?.sources).toEqual([
      expect.objectContaining({
        cron: '0 2 * * *',
        id: 'schedule.user.reindex',
        key: 'schedule:schedule.user.reindex',
        kind: 'schedule',
      }),
    ]);
  });

  test('derives trail-local and signal-local reports without a full graph', () => {
    const created = signal('user.created', {
      payload: z.object({ userId: z.string() }),
    });
    const consumer = trail('user.index', {
      implementation: noop,
      input: z.object({}),
      on: [created],
    });
    const app = topo('activation-report-local', { consumer, created });

    expect(deriveDeclaredTrailActivation(consumer)).toMatchObject({
      activatedBy: [],
      activates: [],
      fires: [],
      on: ['user.created'],
      sources: [expect.objectContaining({ key: 'signal:user.created' })],
    });
    expect(deriveSignalActivationRelations(app, 'user.created')).toEqual({
      consumers: ['user.index'],
      producers: [],
    });
  });
});
