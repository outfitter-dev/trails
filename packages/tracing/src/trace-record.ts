/**
 * TraceRecord lives in `@ontrails/core` as of Phase 1 of the tracing
 * collapse. This module re-exports the canonical type and constructor so
 * existing imports from `@ontrails/tracing` keep working without
 * duplicating the definition.
 */
export { type TraceRecord } from '@ontrails/core';
export { createTraceRecord } from '@ontrails/core';
