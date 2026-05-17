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

/** Collect translated spans without exporting until flush is called. */
const createSpanCollector = (): {
  readonly adapter: ReturnType<typeof createOtelAdapter>;
  readonly spans: OtelSpan[];
} => {
  const spans: OtelSpan[] = [];
  return {
    adapter: createOtelAdapter({
      batchSize: 100,
      exporter: (exported) => {
        spans.push(...exported);
      },
    }),
    spans,
  };
};

const spanById = (spans: readonly OtelSpan[], spanId: string): OtelSpan => {
  const span = spans.find((entry) => entry.spanId === spanId);
  if (span === undefined) {
    throw new Error(`missing span ${spanId}`);
  }
  return span;
};

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

  describe('lineage semantics', () => {
    test('preserves root trail, crossed trail, and child span lineage', async () => {
      const { adapter, spans } = createSpanCollector();

      await adapter.write(
        makeRecord({
          id: 'span-root',
          name: 'orders.checkout',
          parentId: undefined,
          rootId: 'span-root',
          traceId: 'trace-lineage',
          trailId: 'orders.checkout',
        })
      );
      await adapter.write(
        makeRecord({
          id: 'span-crossed',
          name: 'inventory.reserve',
          parentId: 'span-root',
          rootId: 'span-root',
          traceId: 'trace-lineage',
          trailId: 'inventory.reserve',
        })
      );
      await adapter.write(
        makeRecord({
          id: 'span-child',
          kind: 'span',
          name: 'inventory.reserve.validate',
          parentId: 'span-crossed',
          rootId: 'span-root',
          traceId: 'trace-lineage',
          trailId: undefined,
        })
      );
      await adapter.flush();

      const root = spanById(spans, 'span-root');
      const crossed = spanById(spans, 'span-crossed');
      const child = spanById(spans, 'span-child');

      expect(root.kind).toBe('SERVER');
      expect(root.parentSpanId).toBeUndefined();
      expect(root.attributes['trails.span.root_id']).toBe('span-root');
      expect(root.attributes['trails.trail.id']).toBe('orders.checkout');

      expect(crossed.kind).toBe('INTERNAL');
      expect(crossed.parentSpanId).toBe('span-root');
      expect(crossed.traceId).toBe(root.traceId);
      expect(crossed.attributes['trails.span.parent_id']).toBe('span-root');
      expect(crossed.attributes['trails.span.root_id']).toBe('span-root');
      expect(crossed.attributes['trails.trail.id']).toBe('inventory.reserve');

      expect(child.kind).toBe('INTERNAL');
      expect(child.parentSpanId).toBe('span-crossed');
      expect(child.traceId).toBe(root.traceId);
      expect(child.attributes['trails.record.kind']).toBe('span');
      expect(child.attributes['trails.record.name']).toBe(
        'inventory.reserve.validate'
      );
      expect(child.attributes['trails.span.root_id']).toBe('span-root');
      expect(child.attributes['trails.trail.id']).toBeUndefined();
    });

    test('preserves scheduled activation to activated trail lineage', async () => {
      const { adapter, spans } = createSpanCollector();

      await adapter.write(
        makeRecord({
          attrs: {
            'trails.activation.fire_id': 'fire-schedule-1',
            'trails.activation.source.id': 'schedule.provenance.trace',
            'trails.activation.source.kind': 'schedule',
            'trails.activation.target_trail.id': 'provenance.trace',
          },
          id: 'activation-1',
          kind: 'activation',
          name: 'activation.scheduled',
          parentId: undefined,
          rootId: 'activation-1',
          traceId: 'trace-activation',
          trailId: undefined,
        })
      );
      await adapter.write(
        makeRecord({
          attrs: {
            'trails.activation.fire_id': 'fire-schedule-1',
          },
          id: 'trail-1',
          name: 'provenance.trace',
          parentId: 'activation-1',
          rootId: 'activation-1',
          traceId: 'trace-activation',
          trailId: 'provenance.trace',
        })
      );
      await adapter.flush();

      const activation = spanById(spans, 'activation-1');
      const activatedTrail = spanById(spans, 'trail-1');

      expect(activation.kind).toBe('SERVER');
      expect(activation.attributes['trails.activation.event']).toBe(
        'activation.scheduled'
      );
      expect(activation.attributes['trails.activation.source.kind']).toBe(
        'schedule'
      );
      expect(activatedTrail.kind).toBe('INTERNAL');
      expect(activatedTrail.parentSpanId).toBe('activation-1');
      expect(activatedTrail.traceId).toBe(activation.traceId);
      expect(activatedTrail.attributes['trails.span.root_id']).toBe(
        'activation-1'
      );
      expect(activation.attributes['trails.activation.fire_id']).toBe(
        'fire-schedule-1'
      );
      expect(activatedTrail.attributes['trails.activation.fire_id']).toBe(
        'fire-schedule-1'
      );
      expect(activation.attributes['trails.activation.target_trail.id']).toBe(
        'provenance.trace'
      );
    });

    test('preserves signal lifecycle lineage under the producer trail', async () => {
      const { adapter, spans } = createSpanCollector();

      await adapter.write(
        makeRecord({
          id: 'producer-1',
          name: 'order.create',
          parentId: undefined,
          rootId: 'producer-1',
          traceId: 'trace-signal',
          trailId: 'order.create',
        })
      );
      await adapter.write(
        makeRecord({
          attrs: {
            'trails.activation.fire_id': 'fire-signal-1',
            'trails.activation.source.id': 'order.placed',
            'trails.activation.source.kind': 'signal',
            'trails.signal.id': 'order.placed',
            'trails.signal.payload.digest': 'sha256:abc',
            'trails.signal.payload.redacted': true,
            'trails.signal.payload.shape': 'object',
            'trails.signal.run.id': 'producer-1',
          },
          id: 'signal-1',
          kind: 'signal',
          name: 'signal.fired',
          parentId: 'producer-1',
          rootId: 'producer-1',
          traceId: 'trace-signal',
          trailId: undefined,
        })
      );
      await adapter.flush();

      const producer = spanById(spans, 'producer-1');
      const signal = spanById(spans, 'signal-1');

      expect(signal.kind).toBe('INTERNAL');
      expect(signal.parentSpanId).toBe('producer-1');
      expect(signal.traceId).toBe(producer.traceId);
      expect(signal.attributes['trails.signal.event']).toBe('signal.fired');
      expect(signal.attributes['trails.signal.id']).toBe('order.placed');
      expect(signal.attributes['trails.signal.payload.digest']).toBe(
        'sha256:abc'
      );
      expect(signal.attributes['trails.signal.payload.redacted']).toBe(true);
      expect(signal.attributes['trails.signal.run.id']).toBe('producer-1');
    });
  });

  describe('status semantics', () => {
    const errorCases = [
      'validation',
      'not_found',
      'conflict',
      'auth',
      'permission',
      'rate_limit',
      'internal',
    ] as const;

    test('keeps successful spans OK without an error category', async () => {
      const { adapter, spans } = createSpanCollector();

      await adapter.write(
        makeRecord({
          errorCategory: undefined,
          id: 'ok-span',
          status: 'ok',
        })
      );
      await adapter.flush();

      const span = spanById(spans, 'ok-span');
      expect(span.status).toBe('OK');
      expect(span.attributes['trails.status']).toBe('ok');
      expect(span.attributes['trails.error.category']).toBeUndefined();
    });

    test.each(errorCases)(
      'maps %s failures to ERROR while preserving category',
      async (category) => {
        const { adapter, spans } = createSpanCollector();

        await adapter.write(
          makeRecord({
            errorCategory: category,
            id: `err-${category}`,
            status: 'err',
          })
        );
        await adapter.flush();

        const span = spanById(spans, `err-${category}`);
        expect(span.status).toBe('ERROR');
        expect(span.attributes['trails.status']).toBe('err');
        expect(span.attributes['trails.error.category']).toBe(category);
      }
    );

    test('maps cancelled spans to UNSET without inventing an error category', async () => {
      const { adapter, spans } = createSpanCollector();

      await adapter.write(
        makeRecord({
          errorCategory: undefined,
          id: 'cancelled-span',
          status: 'cancelled',
        })
      );
      await adapter.flush();

      const span = spanById(spans, 'cancelled-span');
      expect(span.status).toBe('UNSET');
      expect(span.attributes['trails.status']).toBe('cancelled');
      expect(span.attributes['trails.error.category']).toBeUndefined();
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
    test.each([0, -1, 1.5, Number.NaN])(
      'rejects invalid batchSize %p',
      (batchSize) => {
        expect(() =>
          createOtelAdapter({
            batchSize,
            exporter: () => {},
          })
        ).toThrow('OTel adapter batchSize must be a positive integer');
      }
    );

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

    test('concurrent flush calls await the same exporter drain', async () => {
      const exported: OtelSpan[][] = [];
      const exporterStarted = Promise.withResolvers<undefined>();
      const exporterReleased = Promise.withResolvers<undefined>();
      const adapter = createOtelAdapter({
        batchSize: 10,
        exporter: async (s) => {
          exported.push([...s]);
          exporterStarted.resolve();
          await exporterReleased.promise;
        },
      });

      await adapter.write(makeRecord({ id: 'span-a' }));
      await adapter.write(makeRecord({ id: 'span-b' }));

      const firstFlush = adapter.flush();
      await exporterStarted.promise;
      const secondFlush = adapter.flush();

      exporterReleased.resolve();
      await Promise.all([firstFlush, secondFlush]);

      expect(exported).toHaveLength(1);
      expect(exported[0]?.map((span) => span.spanId)).toEqual([
        'span-a',
        'span-b',
      ]);
    });

    test('auto-flush drains records queued during an active export', async () => {
      const exported: string[][] = [];
      const exporterStarted = Promise.withResolvers<undefined>();
      const exporterReleased = Promise.withResolvers<undefined>();
      let exportCount = 0;
      const adapter = createOtelAdapter({
        batchSize: 1,
        exporter: async (s) => {
          exportCount += 1;
          exported.push(s.map((span) => span.spanId));
          // eslint-disable-next-line jest/no-conditional-in-test -- only the first export is held open
          if (exportCount === 1) {
            exporterStarted.resolve();
            await exporterReleased.promise;
          }
        },
      });

      const firstWrite = adapter.write(makeRecord({ id: 'span-a' }));
      await exporterStarted.promise;
      const secondWrite = adapter.write(makeRecord({ id: 'span-b' }));

      expect(exported).toEqual([['span-a']]);

      exporterReleased.resolve();
      await Promise.all([firstWrite, secondWrite]);

      expect(exported).toEqual([['span-a'], ['span-b']]);
    });

    test('auto-flush leaves below-threshold records buffered', async () => {
      const exported: string[][] = [];
      const exporterStarted = Promise.withResolvers<undefined>();
      const exporterReleased = Promise.withResolvers<undefined>();
      const adapter = createOtelAdapter({
        batchSize: 2,
        exporter: async (s) => {
          exported.push(s.map((span) => span.spanId));
          // eslint-disable-next-line jest/no-conditional-in-test -- only the first export is held open
          if (exported.length === 1) {
            exporterStarted.resolve();
            await exporterReleased.promise;
          }
        },
      });

      await adapter.write(makeRecord({ id: 'span-a' }));
      const secondWrite = adapter.write(makeRecord({ id: 'span-b' }));
      await exporterStarted.promise;
      await adapter.write(makeRecord({ id: 'span-c' }));

      exporterReleased.resolve();
      await secondWrite;

      expect(exported).toEqual([['span-a', 'span-b']]);

      await adapter.flush();

      expect(exported).toEqual([['span-a', 'span-b'], ['span-c']]);
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

    test('restores failed batches ahead of queued records for retry', async () => {
      let shouldFail = true;
      const attempts: string[][] = [];
      const exported: string[][] = [];
      const adapter = createOtelAdapter({
        batchSize: 3,
        exporter: (s) => {
          const spanIds = s.map((span) => span.spanId);
          attempts.push(spanIds);
          // eslint-disable-next-line jest/no-conditional-in-test -- exporter failure is the behavior under test
          if (shouldFail) {
            shouldFail = false;
            throw new Error('partial exporter failure');
          }
          exported.push(spanIds);
        },
      });

      await adapter.write(makeRecord({ id: 'span-a' }));
      await adapter.write(makeRecord({ id: 'span-b' }));
      await expect(adapter.write(makeRecord({ id: 'span-c' }))).rejects.toThrow(
        'partial exporter failure'
      );

      await adapter.write(makeRecord({ id: 'span-d' }));

      expect(attempts[0]).toEqual(['span-a', 'span-b', 'span-c']);
      expect(attempts[1]).toEqual(['span-a', 'span-b', 'span-c', 'span-d']);
      expect(exported).toHaveLength(1);
      expect(exported.flat()).toEqual(['span-a', 'span-b', 'span-c', 'span-d']);
    });

    test('keeps explicit flush and auto-flush to one exporter call each', async () => {
      const exported: string[][] = [];
      const adapter = createOtelAdapter({
        batchSize: 3,
        exporter: (s) => {
          exported.push(s.map((span) => span.spanId));
        },
      });

      await adapter.write(makeRecord({ id: 'span-a' }));
      await adapter.write(makeRecord({ id: 'span-b' }));
      await adapter.flush();
      await adapter.write(makeRecord({ id: 'span-c' }));
      await adapter.write(makeRecord({ id: 'span-d' }));
      await adapter.write(makeRecord({ id: 'span-e' }));

      expect(exported).toEqual([
        ['span-a', 'span-b'],
        ['span-c', 'span-d', 'span-e'],
      ]);
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
