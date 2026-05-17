import { describe, expect, test } from 'bun:test';

import type { TraceRecord } from '../trace-record.js';
import { createOtelAdapter } from '../adapters/otel.js';
import type { OtelSpan } from '../adapters/otel.js';

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

describe('otelAdapter', () => {
  describe('attribute mapping', () => {
    test('maps trailId to attributes["trails.trail.id"]', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(makeRecord({ trailId: 'greet' }));

      expect(spans).toHaveLength(1);
      expect(spans[0]?.attributes['trails.trail.id']).toBe('greet');
    });

    test('maps intent to attributes["trails.intent"]', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(makeRecord({ intent: 'write' }));

      expect(spans[0]?.attributes['trails.intent']).toBe('write');
    });

    test('maps surface to attributes["trails.surface"]', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(makeRecord({ surface: 'mcp' }));

      expect(spans[0]?.attributes['trails.surface']).toBe('mcp');
    });

    test('maps permit.id to attributes["trails.permit.id"]', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(
        makeRecord({ permit: { id: 'p-1', tenantId: 't-1' } })
      );

      expect(spans[0]?.attributes['trails.permit.id']).toBe('p-1');
      expect(spans[0]?.attributes['trails.permit.tenant_id']).toBe('t-1');
    });

    test('omits undefined attributes', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(
        makeRecord({
          intent: undefined,
          surface: undefined,
          trailId: undefined,
        })
      );

      expect(spans).toHaveLength(1);
      const keys = Object.keys(spans[0].attributes);
      expect(keys).not.toContain('trails.trail.id');
      expect(keys).not.toContain('trails.intent');
      expect(keys).not.toContain('trails.surface');
    });

    test('forwards OTel-safe custom attributes', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(
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

    test('maps stable trace identity, lineage, status, and timing attributes', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(
        makeRecord({
          endedAt: 175,
          errorCategory: 'validation',
          id: 'span-child',
          intent: 'destroy',
          parentId: 'span-parent',
          permit: { id: 'permit-1', tenantId: 'tenant-1' },
          rootId: 'span-root',
          sampled: false,
          startedAt: 125,
          status: 'err',
          surface: 'http',
          traceId: 'trace-stable',
          trailId: 'orders.destroy',
        })
      );

      expect(spans[0]?.attributes).toMatchObject({
        'trails.error.category': 'validation',
        'trails.intent': 'destroy',
        'trails.permit.id': 'permit-1',
        'trails.permit.tenant_id': 'tenant-1',
        'trails.record.kind': 'trail',
        'trails.record.name': 'test.echo',
        'trails.sampled': false,
        'trails.span.id': 'span-child',
        'trails.span.parent_id': 'span-parent',
        'trails.span.root_id': 'span-root',
        'trails.status': 'err',
        'trails.surface': 'http',
        'trails.timing.duration_ms': 50,
        'trails.timing.ended_at_ms': 175,
        'trails.timing.started_at_ms': 125,
        'trails.trace.id': 'trace-stable',
        'trails.trail.id': 'orders.destroy',
      });
    });

    test('preserves stable fields when custom attrs try to override them', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(
        makeRecord({
          attrs: {
            'trails.error.category': 'forged-validation',
            'trails.intent': 'destroy',
            'trails.record.kind': 'forged',
            'trails.sampled': false,
            'trails.span.parent_id': 'forged-parent',
            'trails.surface': 'http',
            'trails.timing.ended_at_ms': 1234,
            'trails.trace.id': 'forged-trace',
            'trails.trail.id': 'orders.destroy',
          },
          endedAt: undefined,
          kind: 'trail',
          traceId: 'trace-real',
        })
      );

      expect(spans[0]?.attributes['trails.record.kind']).toBe('trail');
      expect(spans[0]?.attributes['trails.trace.id']).toBe('trace-real');
      expect(spans[0]?.attributes['trails.error.category']).toBeUndefined();
      expect(spans[0]?.attributes['trails.intent']).toBeUndefined();
      expect(spans[0]?.attributes['trails.sampled']).toBeUndefined();
      expect(spans[0]?.attributes['trails.span.parent_id']).toBeUndefined();
      expect(spans[0]?.attributes['trails.surface']).toBeUndefined();
      expect(spans[0]?.attributes['trails.timing.ended_at_ms']).toBeUndefined();
      expect(spans[0]?.attributes['trails.trail.id']).toBeUndefined();
    });

    test('drops raw payload and unredacted error message attributes', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(
        makeRecord({
          attrs: {
            authorization: 'Bearer secret',
            body: '{"secret":true}',
            'error.message': 'card number leaked',
            'http.response.body.byte_length': 128,
            input: '{"secret":true}',
            output: '{"secret":true}',
            payload: '{"secret":true}',
            'trails.input.schema_hash': 'sha256:input',
            'trails.output.schema_hash': 'sha256:output',
            'trails.signal.payload.byte_length': 42,
            'trails.signal.payload.digest': 'sha256:abc',
            'trails.signal.payload.preview': 'redacted?',
            'trails.signal.payload.redacted': true,
            'trails.signal.payload.top_level_entry_count': 3,
          },
        })
      );

      expect(spans[0]?.attributes.authorization).toBeUndefined();
      expect(spans[0]?.attributes.body).toBeUndefined();
      expect(spans[0]?.attributes['error.message']).toBeUndefined();
      expect(spans[0]?.attributes.input).toBeUndefined();
      expect(spans[0]?.attributes.output).toBeUndefined();
      expect(spans[0]?.attributes.payload).toBeUndefined();
      expect(spans[0]?.attributes['http.response.body.byte_length']).toBe(128);
      expect(spans[0]?.attributes['trails.input.schema_hash']).toBe(
        'sha256:input'
      );
      expect(spans[0]?.attributes['trails.output.schema_hash']).toBe(
        'sha256:output'
      );
      expect(spans[0]?.attributes['trails.signal.payload.byte_length']).toBe(
        42
      );
      expect(spans[0]?.attributes['trails.signal.payload.digest']).toBe(
        'sha256:abc'
      );
      expect(
        spans[0]?.attributes['trails.signal.payload.preview']
      ).toBeUndefined();
      expect(spans[0]?.attributes['trails.signal.payload.redacted']).toBe(true);
      expect(
        spans[0]?.attributes['trails.signal.payload.top_level_entry_count']
      ).toBe(3);
    });

    test('maps signal lifecycle attributes without payload leakage', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(
        makeRecord({
          attrs: {
            'trails.signal.id': 'order.placed',
            'trails.signal.payload.shape': 'object',
            'trails.signal.producer_trail.id': 'orders.create',
          },
          kind: 'signal',
          name: 'signal.fired',
        })
      );

      expect(spans[0]?.attributes).toMatchObject({
        'trails.record.kind': 'signal',
        'trails.record.name': 'signal.fired',
        'trails.signal.event': 'signal.fired',
        'trails.signal.id': 'order.placed',
        'trails.signal.payload.shape': 'object',
        'trails.signal.producer_trail.id': 'orders.create',
      });
    });

    test('maps activation boundary attributes without error message leakage', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(
        makeRecord({
          attrs: {
            'exception.message': 'includes raw webhook body',
            'trails.activation.source.id': 'webhook.payment.received',
            'trails.activation.source.kind': 'webhook',
            'trails.activation.target_trail.id': 'payments.receive',
          },
          kind: 'activation',
          name: 'activation.webhook',
        })
      );

      expect(spans[0]?.attributes).toMatchObject({
        'trails.activation.event': 'activation.webhook',
        'trails.activation.source.id': 'webhook.payment.received',
        'trails.activation.source.kind': 'webhook',
        'trails.activation.target_trail.id': 'payments.receive',
        'trails.record.kind': 'activation',
      });
      expect(spans[0]?.attributes['exception.message']).toBeUndefined();
    });
  });

  describe('status mapping', () => {
    test('maps status "ok" to OTel "OK"', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(makeRecord({ status: 'ok' }));

      expect(spans[0]?.status).toBe('OK');
    });

    test('maps status "err" to OTel "ERROR"', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(makeRecord({ status: 'err' }));

      expect(spans[0]?.status).toBe('ERROR');
    });

    test('maps status "cancelled" to OTel "UNSET"', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(makeRecord({ status: 'cancelled' }));

      expect(spans[0]?.status).toBe('UNSET');
    });
  });

  describe('kind mapping', () => {
    test('root trail (no parentId) gets kind "SERVER"', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(makeRecord({ parentId: undefined }));

      expect(spans[0]?.kind).toBe('SERVER');
    });

    test('child trail (has parentId) gets kind "INTERNAL"', async () => {
      const spans: OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          spans.push(...s);
        },
      });

      await adapter.write(makeRecord({ parentId: 'parent-1' }));

      expect(spans[0]?.kind).toBe('INTERNAL');
    });
  });

  describe('exporter integration', () => {
    test('calls exporter with translated spans', async () => {
      let exportedSpans: readonly OtelSpan[] = [];
      const adapter = createOtelAdapter({
        exporter: (s) => {
          exportedSpans = s;
        },
      });

      await adapter.write(makeRecord({ id: 'span-42', traceId: 'trace-42' }));

      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.spanId).toBe('span-42');
      expect(exportedSpans[0]?.traceId).toBe('trace-42');
    });
  });

  describe('flush', () => {
    test('sends buffered spans that have not yet reached batchSize', async () => {
      const exported: OtelSpan[][] = [];
      const adapter = createOtelAdapter({
        batchSize: 5,
        exporter: (s) => {
          exported.push([...s]);
        },
      });

      await adapter.write(makeRecord({ id: 'span-a' }));
      await adapter.write(makeRecord({ id: 'span-b' }));

      // Not yet exported because batchSize is 5
      expect(exported).toHaveLength(0);

      await adapter.flush();

      expect(exported).toHaveLength(1);
      expect(exported[0]).toHaveLength(2);
      expect(exported[0]?.[0]?.spanId).toBe('span-a');
      expect(exported[0]?.[1]?.spanId).toBe('span-b');
    });

    test('auto-flushes when batchSize is reached', async () => {
      const exported: OtelSpan[][] = [];
      const adapter = createOtelAdapter({
        batchSize: 3,
        exporter: (s) => {
          exported.push([...s]);
        },
      });

      await adapter.write(makeRecord({ id: 'span-a' }));
      await adapter.write(makeRecord({ id: 'span-b' }));

      // Two writes — still buffered
      expect(exported).toHaveLength(0);

      await adapter.write(makeRecord({ id: 'span-c' }));

      // Third write reaches batchSize=3, exporter must have been called
      expect(exported).toHaveLength(1);
      expect(exported[0]).toHaveLength(3);
    });

    test('rethrows exporter failures and restores the buffer', async () => {
      let shouldFail = true;
      const exported: OtelSpan[][] = [];
      const adapter = createOtelAdapter({
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

      await adapter.write(makeRecord({ id: 'span-a' }));
      await expect(adapter.write(makeRecord({ id: 'span-b' }))).rejects.toThrow(
        'exporter down'
      );

      // First flush failed — spans should still be buffered
      expect(exported).toHaveLength(0);

      // Manual flush retries and succeeds
      await adapter.flush();
      expect(exported).toHaveLength(1);
      expect(exported[0]).toHaveLength(2);
    });

    test('is a no-op when buffer is empty', async () => {
      let called = false;
      const adapter = createOtelAdapter({
        exporter: () => {
          called = true;
        },
      });

      await adapter.flush();

      expect(called).toBe(false);
    });
  });
});
