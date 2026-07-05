/**
 * Incident lifecycle money tests: probe transitions drive `probe.failed` /
 * `probe.recovered`, incidents open exactly once per outage (transition
 * dedupe), notifications dispatch, and recovery resolves.
 */

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';

import { graph } from '../src/app.js';
import { createScriptedProbeHttp } from '../src/resources/probe-http.js';
import type { ProbeReply } from '../src/resources/probe-http.js';
import { db } from '../src/store.js';

const STEADY_URL = 'http://localhost:4090/steady';

const ok = (): ProbeReply => ({ body: 'ok', kind: 'response', status: 200 });
const fail = (): ProbeReply => ({ body: '', kind: 'response', status: 503 });

const mockStore = async () => {
  if (!db.mock) {
    throw new Error('lookout.db mock factory missing');
  }
  return await db.mock();
};

const failedPayload = (at: string) => ({
  at,
  checkId: 'chk_steady',
  checkName: 'steady',
  failureReason: 'upstream answered 503',
  probeId: 'prb_x',
  url: STEADY_URL,
});

describe('incident lifecycle via probe transitions', () => {
  test('an outage opens ONE incident across repeated failing probes, then resolves', async () => {
    const store = await mockStore();
    const resources = {
      'lookout.db': store,
      'lookout.probe-http': createScriptedProbeHttp({
        // Run 1: hard outage (initial + 2 retries). Run 2: still out.
        // Run 3: recovery.
        [STEADY_URL]: [fail(), fail(), fail(), fail(), fail(), fail(), ok()],
      }),
    };

    // First failing probe: unknown→down opens an incident and notifies.
    const first = await run(
      graph,
      'probe.run',
      { checkId: 'chk_steady' },
      { resources }
    );
    expect(first.isOk()).toBe(true);
    let incidents = await store.incidents.list({ checkId: 'chk_steady' });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.status).toBe('open');

    let notifications = await store.notifications.list();
    const openedNotes = notifications.filter(
      (note) => note.incidentId === incidents[0]?.id
    );
    expect(openedNotes).toHaveLength(1);
    expect(openedNotes[0]?.channel).toBe('console');

    // Second failing probe: down→down fires nothing — still ONE incident.
    const second = await run(
      graph,
      'probe.run',
      { checkId: 'chk_steady' },
      { resources }
    );
    expect(second.isOk()).toBe(true);
    incidents = await store.incidents.list({ checkId: 'chk_steady' });
    expect(incidents).toHaveLength(1);

    // Recovery: down→up resolves the incident and notifies again.
    const third = await run(
      graph,
      'probe.run',
      { checkId: 'chk_steady' },
      { resources }
    );
    expect(third.isOk()).toBe(true);
    incidents = await store.incidents.list({ checkId: 'chk_steady' });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.status).toBe('resolved');
    expect(incidents[0]?.resolvedAt).not.toBeNull();

    notifications = await store.notifications.list();
    const incidentNotes = notifications.filter(
      (note) => note.incidentId === incidents[0]?.id
    );
    expect(incidentNotes).toHaveLength(2);
  });

  test('incident.open dedupes a duplicate failure payload', async () => {
    const store = await mockStore();
    const resources = { 'lookout.db': store };

    const first = await run(
      graph,
      'incident.open',
      failedPayload('2026-07-01T03:12:00.000Z'),
      { resources }
    );
    expect(first.isOk()).toBe(true);
    if (first.isOk()) {
      expect((first.value as { deduped: boolean }).deduped).toBe(false);
    }

    const second = await run(
      graph,
      'incident.open',
      failedPayload('2026-07-01T03:13:00.000Z'),
      { resources }
    );
    expect(second.isOk()).toBe(true);
    if (second.isOk()) {
      expect((second.value as { deduped: boolean }).deduped).toBe(true);
    }

    const incidents = await store.incidents.list({ checkId: 'chk_steady' });
    expect(incidents).toHaveLength(1);
  });

  test('a transient blip that recovers through detours never opens an incident', async () => {
    const store = await mockStore();
    const resources = {
      'lookout.db': store,
      'lookout.probe-http': createScriptedProbeHttp({
        [STEADY_URL]: [fail(), fail(), ok()],
      }),
    };

    const result = await run(
      graph,
      'probe.run',
      { checkId: 'chk_steady' },
      { resources }
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect((result.value as { outcome: string }).outcome).toBe(
        'recovered-after-retry'
      );
    }

    const incidents = await store.incidents.list({ checkId: 'chk_steady' });
    expect(incidents).toHaveLength(0);
    expect(await store.notifications.list()).toHaveLength(0);
  });
});

describe('probe.sweep scheduling', () => {
  test('sweeps due enabled checks and respects pause/resume', async () => {
    const store = await mockStore();
    const resources = {
      'lookout.db': store,
      'lookout.probe-http': createScriptedProbeHttp(),
    };
    const adminPermit = { id: 'test', scopes: ['lookout:admin'] };

    const first = await run(graph, 'probe.sweep', {}, { resources });
    expect(first.isOk()).toBe(true);
    if (first.isOk()) {
      const value = first.value as { due: string[]; probed: number };
      expect(value.probed).toBe(2);
      expect(value.due.toSorted()).toEqual(['chk_flaky', 'chk_steady']);
    }

    // Immediately after, nothing is due (intervals are 30s).
    const second = await run(graph, 'probe.sweep', {}, { resources });
    expect(second.isOk()).toBe(true);
    if (second.isOk()) {
      expect((second.value as { probed: number }).probed).toBe(0);
    }

    // Pausing removes a check from scheduling even when due again.
    const paused = await run(
      graph,
      'check.pause',
      { id: 'chk_flaky' },
      { permit: adminPermit, resources }
    );
    expect(paused.isOk()).toBe(true);

    // Make everything due again by aging the recorded probes.
    const probes = await store.probes.list();
    for (const probe of probes) {
      await store.probes.update(probe.id, {
        startedAt: '2026-07-01T00:00:00.000Z',
      });
    }

    const third = await run(graph, 'probe.sweep', {}, { resources });
    expect(third.isOk()).toBe(true);
    if (third.isOk()) {
      expect((third.value as { due: string[] }).due).toEqual(['chk_steady']);
    }

    // Resuming puts the check back into scheduling.
    const resumed = await run(
      graph,
      'check.resume',
      { id: 'chk_flaky' },
      { permit: adminPermit, resources }
    );
    expect(resumed.isOk()).toBe(true);

    const fourth = await run(graph, 'probe.sweep', {}, { resources });
    expect(fourth.isOk()).toBe(true);
    if (fourth.isOk()) {
      expect((fourth.value as { due: string[] }).due).toContain('chk_flaky');
    }
  });
});
