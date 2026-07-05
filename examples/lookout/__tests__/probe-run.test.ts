/**
 * The money tests for `probe.run`: scripted per-URL reply sequences prove the
 * detour contracts recover transient failures with bounded retries, record
 * the honest `recovered-after-retry` middle state, and classify exhausted or
 * definitive failures as `down`.
 */

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';

import { graph } from '../src/app.js';
import { createScriptedProbeHttp } from '../src/resources/probe-http.js';
import type { ProbeReply } from '../src/resources/probe-http.js';
import { db } from '../src/store.js';
import type { ProbeRunOutput } from '../src/trails/probe.js';

const FLAKY_URL = 'http://localhost:4090/flaky';

const ok = (body = 'ok'): ProbeReply => ({
  body,
  kind: 'response',
  status: 200,
});
const status = (code: number): ProbeReply => ({
  body: '',
  kind: 'response',
  status: code,
});
const timeout = (): ProbeReply => ({ kind: 'timeout' });
const reset = (): ProbeReply => ({
  kind: 'connection-reset',
  message: 'read ECONNRESET',
});

const mockStore = async () => {
  if (!db.mock) {
    throw new Error('lookout.db mock factory missing');
  }
  return await db.mock();
};

const createHarness = async (script: Record<string, readonly ProbeReply[]>) => {
  const store = await mockStore();
  return {
    resources: {
      'lookout.db': store,
      'lookout.probe-http': createScriptedProbeHttp(script),
    },
    store,
  };
};

const runProbe = async (
  resources: Record<string, unknown>,
  checkId: string
): Promise<ProbeRunOutput> => {
  const result = await run(graph, 'probe.run', { checkId }, { resources });
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value as ProbeRunOutput;
};

describe('probe.run detour recovery', () => {
  test('fail, fail, succeed records recovered-after-retry', async () => {
    const { resources, store } = await createHarness({
      [FLAKY_URL]: [status(503), status(503), ok()],
    });

    const output = await runProbe(resources, 'chk_flaky');

    expect(output.outcome).toBe('recovered-after-retry');
    expect(output.attempts).toBe(3);
    expect(output.state).toBe('up');
    expect(output.failureReason).toBeNull();
    // unknown → up is not a recovery transition.
    expect(output.transition).toBe('none');

    const rows = await store.probes.list({ checkId: 'chk_flaky' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('recovered-after-retry');
    expect(rows[0]?.attempts).toBe(3);
    const check = await store.checks.get('chk_flaky');
    expect(check?.state).toBe('up');
  });

  test('a single transient blip recovers on the first retry', async () => {
    const { resources } = await createHarness({
      [FLAKY_URL]: [status(502), ok()],
    });

    const output = await runProbe(resources, 'chk_flaky');

    expect(output.outcome).toBe('recovered-after-retry');
    expect(output.attempts).toBe(2);
  });

  test('timeouts recover through the timeout detour', async () => {
    const { resources } = await createHarness({
      [FLAKY_URL]: [timeout(), ok()],
    });

    const output = await runProbe(resources, 'chk_flaky');

    expect(output.outcome).toBe('recovered-after-retry');
    expect(output.attempts).toBe(2);
  });

  test('connection resets recover through the network detour', async () => {
    const { resources } = await createHarness({
      [FLAKY_URL]: [reset(), ok()],
    });

    const output = await runProbe(resources, 'chk_flaky');

    expect(output.outcome).toBe('recovered-after-retry');
    expect(output.attempts).toBe(2);
  });

  test('three transient failures exhaust retries and record down', async () => {
    const { resources, store } = await createHarness({
      [FLAKY_URL]: [status(503), status(503), status(503)],
    });

    const output = await runProbe(resources, 'chk_flaky');

    expect(output.outcome).toBe('down');
    expect(output.attempts).toBe(3);
    expect(output.state).toBe('down');
    expect(output.failureReason).toContain('503');
    expect(output.transition).toBe('failed');

    const rows = await store.probes.list({ checkId: 'chk_flaky' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('down');
    const check = await store.checks.get('chk_flaky');
    expect(check?.state).toBe('down');
  });

  test('a definitive failure records down without retrying', async () => {
    const { resources } = await createHarness({
      [FLAKY_URL]: [status(404)],
    });

    const output = await runProbe(resources, 'chk_flaky');

    expect(output.outcome).toBe('down');
    expect(output.attempts).toBe(1);
    expect(output.failureReason).toContain('404');
  });

  test('a body expectation miss records down without retrying', async () => {
    const store = await mockStore();
    await store.checks.update('chk_flaky', {
      expect: { bodyIncludes: 'healthy', status: 200 },
    });
    const resources = {
      'lookout.db': store,
      'lookout.probe-http': createScriptedProbeHttp({
        [FLAKY_URL]: [ok('degraded')],
      }),
    };

    const output = await runProbe(resources, 'chk_flaky');

    expect(output.outcome).toBe('down');
    expect(output.attempts).toBe(1);
    expect(output.failureReason).toContain('healthy');
  });
});

describe('probe.run state transitions', () => {
  test('up to down flags a failed transition; down stays down silently', async () => {
    const { resources } = await createHarness({
      [FLAKY_URL]: [
        ok(),
        // Second run: hard outage (three transient failures).
        status(503),
        status(503),
        status(503),
        // Third run: still out.
        status(503),
        status(503),
        status(503),
      ],
    });

    const first = await runProbe(resources, 'chk_flaky');
    expect(first.state).toBe('up');
    expect(first.transition).toBe('none');

    const second = await runProbe(resources, 'chk_flaky');
    expect(second.previousState).toBe('up');
    expect(second.state).toBe('down');
    expect(second.transition).toBe('failed');

    // Transition semantics, not per-probe: a still-down probe is not a new
    // failure transition.
    const third = await runProbe(resources, 'chk_flaky');
    expect(third.state).toBe('down');
    expect(third.transition).toBe('none');
  });

  test('down to up flags a recovered transition', async () => {
    const { resources } = await createHarness({
      [FLAKY_URL]: [status(503), status(503), status(503), ok()],
    });

    const outage = await runProbe(resources, 'chk_flaky');
    expect(outage.state).toBe('down');

    const recovery = await runProbe(resources, 'chk_flaky');
    expect(recovery.previousState).toBe('down');
    expect(recovery.state).toBe('up');
    expect(recovery.transition).toBe('recovered');
    expect(recovery.outcome).toBe('up');
  });

  test('a recovery via detour from a down state is a recovered transition', async () => {
    const { resources } = await createHarness({
      [FLAKY_URL]: [
        status(503),
        status(503),
        status(503),
        // Second run: one blip, then healthy — recovered-after-retry.
        status(503),
        ok(),
      ],
    });

    const outage = await runProbe(resources, 'chk_flaky');
    expect(outage.state).toBe('down');

    const recovery = await runProbe(resources, 'chk_flaky');
    expect(recovery.outcome).toBe('recovered-after-retry');
    expect(recovery.transition).toBe('recovered');
  });
});

describe('probe.prune retention', () => {
  test('prunes the oldest rows beyond the retention cap', async () => {
    const store = await mockStore();
    for (let index = 0; index < 7; index += 1) {
      await store.probes.insert({
        attempts: 1,
        checkId: 'chk_steady',
        durationMs: 5,
        failureReason: null,
        outcome: 'up',
        startedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      });
    }
    const resources = { 'lookout.db': store };

    const pruned = await run(
      graph,
      'probe.prune',
      { keepPerCheck: 3 },
      { permit: { id: 'test', scopes: ['lookout:admin'] }, resources }
    );
    expect(pruned.isOk()).toBe(true);

    const remaining = await store.probes.list({ checkId: 'chk_steady' });
    expect(remaining).toHaveLength(3);
    const startedAts = remaining.map((probe) => probe.startedAt).toSorted();
    expect(startedAts[0]).toContain('00:04');
  });

  test('dry run reports without deleting', async () => {
    const store = await mockStore();
    for (let index = 0; index < 5; index += 1) {
      await store.probes.insert({
        attempts: 1,
        checkId: 'chk_steady',
        durationMs: 5,
        failureReason: null,
        outcome: 'up',
        startedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      });
    }
    const resources = { 'lookout.db': store };

    const result = await run(
      graph,
      'probe.prune',
      { keepPerCheck: 2 },
      {
        dryRun: true,
        permit: { id: 'test', scopes: ['lookout:admin'] },
        resources,
      }
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ dryRun: true, removed: 3 });
    }

    const remaining = await store.probes.list({ checkId: 'chk_steady' });
    expect(remaining).toHaveLength(5);
  });
});
