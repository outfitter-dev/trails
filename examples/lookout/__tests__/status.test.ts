/**
 * Fixed-vector uptime math tests plus the HTTP surface split: public status
 * reads need no auth, admin trails reject without the bearer token and work
 * with it.
 */

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';
import { createHttpHarness } from '@ontrails/testing/http';

import { graph } from '../src/app.js';
import { resolveHttpPermit } from '../src/permits.js';
import { db } from '../src/store.js';
import { computeUptime } from '../src/trails/status.js';

const mockStore = async () => {
  if (!db.mock) {
    throw new Error('lookout.db mock factory missing');
  }
  return await db.mock();
};

describe('uptime math fixed vectors', () => {
  test('no probes means no uptime claim', () => {
    expect(computeUptime([])).toEqual({
      downCount: 0,
      probeCount: 0,
      recoveredCount: 0,
      upCount: 0,
      uptimePercent: null,
    });
  });

  test('all up is 100%', () => {
    const probes = [{ outcome: 'up' as const }, { outcome: 'up' as const }];
    expect(computeUptime(probes).uptimePercent).toBe(100);
  });

  test('recovered-after-retry counts as healthy', () => {
    const probes = [
      { outcome: 'up' as const },
      { outcome: 'recovered-after-retry' as const },
      { outcome: 'down' as const },
      { outcome: 'up' as const },
    ];
    const stats = computeUptime(probes);
    expect(stats).toEqual({
      downCount: 1,
      probeCount: 4,
      recoveredCount: 1,
      upCount: 2,
      uptimePercent: 75,
    });
  });

  test('percentages round to two decimals', () => {
    const probes = [
      { outcome: 'up' as const },
      { outcome: 'up' as const },
      { outcome: 'down' as const },
    ];
    expect(computeUptime(probes).uptimePercent).toBe(66.67);
  });
});

describe('uptime.report windowing', () => {
  test('only probes inside the window count', async () => {
    const store = await mockStore();
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await store.probes.insert({
      attempts: 1,
      checkId: 'chk_steady',
      durationMs: 5,
      failureReason: null,
      outcome: 'up',
      startedAt: recent,
    });
    await store.probes.insert({
      attempts: 3,
      checkId: 'chk_steady',
      durationMs: 900,
      failureReason: 'upstream answered 503',
      outcome: 'down',
      // Far outside any 7-day window.
      startedAt: '2020-01-01T00:00:00.000Z',
    });

    const report = await run(
      graph,
      'uptime.report',
      { checkId: 'chk_steady', days: 7 },
      { resources: { 'lookout.db': store } }
    );
    expect(report.isOk()).toBe(true);
    if (report.isOk()) {
      expect(report.value).toMatchObject({
        probeCount: 1,
        uptimePercent: 100,
      });
    }
  });
});

describe('HTTP surface: public status page vs admin permit', () => {
  const createHarness = async () => {
    const store = await mockStore();
    return createHttpHarness({
      graph,
      resolvePermit: resolveHttpPermit,
      resources: { 'lookout.db': store },
    });
  };

  test('status summary and badge respond without auth', async () => {
    const http = await createHarness();

    const summary = await http.get('/status/summary');
    expect(summary.status).toBe(200);

    const badge = await http.get('/status/badge', { checkId: 'chk_steady' });
    expect(badge.status).toBe(200);
    expect(badge.body).toMatchObject({
      data: { label: 'steady', state: 'unknown' },
    });

    const incidents = await http.get('/incident/list');
    expect(incidents.status).toBe(200);
  });

  test('admin trails reject without a token and work with one', async () => {
    process.env['LOOKOUT_ADMIN_TOKEN'] = 'secret-test-token';
    try {
      const http = await createHarness();
      const input = {
        intervalSeconds: 60,
        name: 'api',
        url: 'https://api.example.com/health',
      };

      const denied = await http.post('/check/create', input);
      expect(denied.status).toBe(403);

      const wrongToken = await http.post('/check/create', input, {
        headers: { authorization: 'Bearer not-the-token' },
      });
      expect(wrongToken.status).toBe(403);

      const allowed = await http.post('/check/create', input, {
        headers: { authorization: 'Bearer secret-test-token' },
      });
      expect(allowed.status).toBe(200);
      expect(allowed.body).toMatchObject({ data: { name: 'api' } });
    } finally {
      delete process.env['LOOKOUT_ADMIN_TOKEN'];
    }
  });
});
