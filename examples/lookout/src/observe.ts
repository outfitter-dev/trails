/**
 * Observe wiring: one in-memory trace store plus a console log sink.
 *
 * The dev store doubles as the memory trace sink for the topo and the
 * queryable backend behind `tracing.query`, so the MCP surface can answer
 * "what ran last night and why did it fail" from the same records the
 * runtime wrote.
 */

import { createConsoleSink } from '@ontrails/observe';
import type { ObserveConfig } from '@ontrails/observe';
import { createDevStore, registerTraceStore } from '@ontrails/tracing';

export const traceStore = createDevStore();

// Register the store so tracingResource (behind tracing.query/tracing.status)
// reads the same records the topo's trace sink writes.
registerTraceStore(traceStore);

export const observeConfig: ObserveConfig = {
  log: createConsoleSink(),
  trace: traceStore,
};
