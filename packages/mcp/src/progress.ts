/**
 * Bridge Trails ProgressCallback to MCP sendProgress notifications.
 */

import type { ProgressCallback, ProgressEvent } from '@ontrails/core';

import type { McpExtra } from './build.js';

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

type SendFn = (current: number, total: number) => Promise<void>;

/** Fire-and-forget a progress send, swallowing transport errors. */
const fireSend = async (
  send: SendFn,
  current: number,
  total: number
): Promise<void> => {
  try {
    await send(current, total);
  } catch {
    /* Transport errors are expected and safe to ignore */
  }
};

const handleProgress = (event: ProgressEvent, send: SendFn): void => {
  if (event.current !== undefined && event.total !== undefined) {
    fireSend(send, event.current, event.total);
  } else if (event.current !== undefined) {
    fireSend(send, event.current, 0);
  }
};

const progressHandlers: Record<
  string,
  (event: ProgressEvent, send: SendFn) => void
> = {
  complete: (_event, send) => fireSend(send, 1, 1),
  error: () => {
    /* No progress notification for errors */
  },
  progress: handleProgress,
  start: (_event, send) => fireSend(send, 0, 1),
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ProgressCallback that bridges to MCP's sendProgress.
 *
 * Returns `undefined` if the MCP client did not provide a progressToken
 * (meaning no progress reporting was requested).
 */
export const createMcpProgressCallback = (
  extra: McpExtra
): ProgressCallback | undefined => {
  if (extra.progressToken === undefined || extra.progressToken === null) {
    return undefined;
  }
  if (typeof extra.sendProgress !== 'function') {
    return undefined;
  }

  const send = extra.sendProgress;
  return (event: ProgressEvent): void => {
    const handler = progressHandlers[event.type];
    handler?.(event, send);
  };
};
