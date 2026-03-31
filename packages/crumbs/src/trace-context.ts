/** Trace context carried through trail execution. */
export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly rootId: string;
  readonly sampled: boolean;
}

/** Key used to store trace context in ctx.extensions. */
export const TRACE_CONTEXT_KEY = '__crumbs_trace';

/** Read trace context from trail context extensions. */
export const getTraceContext = (ctx: {
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}): TraceContext | undefined =>
  ctx.extensions?.[TRACE_CONTEXT_KEY] as TraceContext | undefined;

/** Create a child trace context inheriting from a parent. */
export const childTraceContext = (parent: TraceContext): TraceContext => ({
  rootId: parent.rootId,
  sampled: parent.sampled,
  spanId: Bun.randomUUIDv7(),
  traceId: parent.traceId,
});
