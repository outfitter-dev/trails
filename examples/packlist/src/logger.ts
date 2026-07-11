/**
 * Minimal stderr logger for the packlist surfaces.
 *
 * Implementations never print — they log through `ctx.logger`, and each surface
 * entry point decides where that goes. This one writes info and above to
 * stderr so reactive work (like `pack.recalculate`) is visible in normal
 * CLI output without polluting stdout's structured results.
 */

import type { Logger } from '@ontrails/core';

const write = (
  level: string,
  message: string,
  data?: Record<string, unknown>
): void => {
  const suffix =
    data === undefined || Object.keys(data).length === 0
      ? ''
      : ` ${JSON.stringify(data)}`;
  process.stderr.write(`[packlist] ${level} ${message}${suffix}\n`);
};

export const createStderrLogger = (
  context: Record<string, unknown> = {}
): Logger => ({
  child: (childContext) => createStderrLogger({ ...context, ...childContext }),
  debug: () => {
    // silent unless surfaced later
  },
  error: (message, data) => write('error', message, data),
  fatal: (message, data) => write('fatal', message, data),
  info: (message, data) => write('info', message, data),
  name: 'packlist',
  trace: () => {
    // silent unless surfaced later
  },
  warn: (message, data) => write('warn', message, data),
});
