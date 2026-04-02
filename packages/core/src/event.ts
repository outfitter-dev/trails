/**
 * Legacy event aliases for the signal model.
 *
 * Keep this file as a compatibility seam while the repo-wide cutover lands.
 */

export { signal as event } from './signal.js';
export type {
  AnySignal,
  AnySignal as AnyEvent,
  Signal,
  Signal as Event,
  SignalSpec,
  SignalSpec as EventSpec,
} from './signal.js';
