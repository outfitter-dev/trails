import { describe, expect, test } from 'bun:test';

import type { TraceRecord } from '../trace-record.js';
import { createOtelConnector } from '../connectors/otel.js';
import type { OtelSpan } from '../connectors/otel.js';

/** Build a minimal TraceRecord for testing with sensible defaults. */
const makeRecord = (overrides: Partial<TraceRecord> = {}): TraceRecord => ({
  attrs: {},
  endedAt: 1000,
  id: 'span-1',
  kind: 'trail',
  name: 'test.echo',
  rootId: 'root-1',
  startedAt: 0,
  status: 'ok',
  traceId: 'trace-1',
  ...overrides,
});

describe('otelConnector', () => {
  describe('attribute mapping', () => {
    test('maps trailId to attributes["trails.trail.id"]', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(makeRecord({ trailId: 'greet' }));

      expect(spans).toHaveLength(1);
      expect(spans[0]?.attributes['trails.trail.id']).toBe('greet');
    });

    test('maps intent to attributes["trails.intent"]', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(makeRecord({ intent: 'write' }));

      expect(spans[0]?.attributes['trails.intent']).toBe('write');
    });

    test('maps trailhead to attributes["trails.trailhead"]', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(makeRecord({ trailhead: 'mcp' }));

      expect(spans[0]?.attributes['trails.trailhead']).toBe('mcp');
    });

    test('maps permit.id to attributes["trails.permit.id"]', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(
        makeRecord({ permit: { id: 'p-1', tenantId: 't-1' } })
      );

      expect(spans[0]?.attributes['trails.permit.id']).toBe('p-1');
      expect(spans[0]?.attributes['trails.permit.tenant_id']).toBe('t-1');
    });

    test('omits undefined attributes', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(
        makeRecord({
          intent: undefined,
          trailId: undefined,
          trailhead: undefined,
        })
      );

      expect(spans).toHaveLength(1);
      const keys = Object.keys(spans[0].attributes);
      expect(keys).not.toContain('trails.trail.id');
      expect(keys).not.toContain('trails.intent');
      expect(keys).not.toContain('trails.trailhead');
    });

    test('forwards OTel-safe custom attributes', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(
        makeRecord({
          attrs: {
            'db.operation': 'select',
            'http.status_code': 200,
            sampled: true,
            skipped: { nested: true },
          },
        })
      );

      expect(spans[0]?.attributes['db.operation']).toBe('select');
      expect(spans[0]?.attributes['http.status_code']).toBe(200);
      expect(spans[0]?.attributes.sampled).toBe(true);
      expect(spans[0]?.attributes.skipped).toBeUndefined();
    });
  });

  describe('status mapping', () => {
    test('maps status "ok" to OTel "OK"', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(makeRecord({ status: 'ok' }));

      expect(spans[0]?.status).toBe('OK');
    });

    test('maps status "err" to OTel "ERROR"', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(makeRecord({ status: 'err' }));

      expect(spans[0]?.status).toBe('ERROR');
    });

    test('maps status "cancelled" to OTel "UNSET"', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(makeRecord({ status: 'cancelled' }));

      expect(spans[0]?.status).toBe('UNSET');
    });
  });

  describe('kind mapping', () => {
    test('root trail (no parentId) gets kind "SERVER"', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(makeRecord({ parentId: undefined }));

      expect(spans[0]?.kind).toBe('SERVER');
    });

    test('child trail (has parentId) gets kind "INTERNAL"', async () => {
      const spans: OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await connector.write(makeRecord({ parentId: 'parent-1' }));

      expect(spans[0]?.kind).toBe('INTERNAL');
    });
  });

  describe('exporter integration', () => {
    test('calls exporter with translated spans', async () => {
      let exportedSpans: readonly OtelSpan[] = [];
      const connector = createOtelConnector({
        exporter: (s) => {
          exportedSpans = s;
        },
      });

      await connector.write(makeRecord({ id: 'span-42', traceId: 'trace-42' }));

      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.spanId).toBe('span-42');
      expect(exportedSpans[0]?.traceId).toBe('trace-42');
    });
  });

  describe('flush', () => {
    test('sends buffered spans that have not yet reached batchSize', async () => {
      const exported: OtelSpan[][] = [];
      const connector = createOtelConnector({
        batchSize: 5,
        exporter: (s) => {
          exported.push([...s]);
        },
      });

      await connector.write(makeRecord({ id: 'span-a' }));
      await connector.write(makeRecord({ id: 'span-b' }));

      // Not yet exported because batchSize is 5
      expect(exported).toHaveLength(0);

      await connector.flush();

      expect(exported).toHaveLength(1);
      expect(exported[0]).toHaveLength(2);
      expect(exported[0]?.[0]?.spanId).toBe('span-a');
      expect(exported[0]?.[1]?.spanId).toBe('span-b');
    });

    test('auto-flushes when batchSize is reached', async () => {
      const exported: OtelSpan[][] = [];
      const connector = createOtelConnector({
        batchSize: 3,
        exporter: (s) => {
          exported.push([...s]);
        },
      });

      await connector.write(makeRecord({ id: 'span-a' }));
      await connector.write(makeRecord({ id: 'span-b' }));

      // Two writes — still buffered
      expect(exported).toHaveLength(0);

      await connector.write(makeRecord({ id: 'span-c' }));

      // Third write reaches batchSize=3, exporter must have been called
      expect(exported).toHaveLength(1);
      expect(exported[0]).toHaveLength(3);
    });

    test('rethrows exporter failures and restores the buffer', async () => {
      let shouldFail = true;
      const exported: OtelSpan[][] = [];
      const connector = createOtelConnector({
        batchSize: 2,
        exporter: (s) => {
          // eslint-disable-next-line jest/no-conditional-in-test -- testing retry behavior requires toggling exporter success
          const fail = shouldFail;
          shouldFail = false;
          // eslint-disable-next-line jest/no-conditional-in-test
          if (fail) {
            throw new Error('exporter down');
          }
          exported.push([...s]);
        },
      });

      await connector.write(makeRecord({ id: 'span-a' }));
      await expect(
        connector.write(makeRecord({ id: 'span-b' }))
      ).rejects.toThrow('exporter down');

      // First flush failed — spans should still be buffered
      expect(exported).toHaveLength(0);

      // Manual flush retries and succeeds
      await connector.flush();
      expect(exported).toHaveLength(1);
      expect(exported[0]).toHaveLength(2);
    });

    test('is a no-op when buffer is empty', async () => {
      let called = false;
      const connector = createOtelConnector({
        exporter: () => {
          called = true;
        },
      });

      await connector.flush();

      expect(called).toBe(false);
    });
  });
});
