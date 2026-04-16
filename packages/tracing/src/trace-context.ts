/**
 * Trace context primitives live in `@ontrails/core` as of Phase 1 of the
 * tracing collapse. This module re-exports them so existing imports from
 * `@ontrails/tracing` keep working. `createChildTraceContext` remains available as
 * a small utility for tests and custom adapters that need to derive a child
 * trace context outside of `executeTrail`.
 */
import type { TraceContext } from '@ontrails/core';

export { getTraceContext, type TraceContext } from '@ontrails/core';
export { TRACE_CONTEXT_KEY } from '@ontrails/core/internal/tracing';

/** Create a child trace context inheriting from a parent. */
export const createChildTraceContext = (
  parent: TraceContext
): TraceContext => ({
  rootId: parent.rootId,
  sampled: parent.sampled,
  spanId: Bun.randomUUIDv7(),
  traceId: parent.traceId,
});
