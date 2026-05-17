import type { LogSink } from '@ontrails/observe';

/**
 * Package identifier for the publishable Pino adapter package.
 */
export const pinoPackageName = '@ontrails/pino';

/**
 * Placeholder sink type for the package scaffold.
 *
 * @remarks The structural Pino sink is implemented in the follow-up Pino
 * issue; this alias keeps the scaffold tied to the public observe contract
 * without adding a runtime dependency on `pino`.
 */
export type PinoLogSink = LogSink;
