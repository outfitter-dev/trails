import type { AnySignal, Signal } from '../signal.js';

export interface LateBoundSignalRef {
  readonly kind: 'store-derived';
  readonly token: string;
}

export interface LateBoundSignalMarker {
  readonly displayId: string;
  readonly token: string;
}

const LATE_BOUND_SIGNAL_REF = Symbol('trails.late-bound-signal-ref');
const LATE_BOUND_SIGNAL_MARKER_PREFIX = '@@trails:late-bound-signal-ref:';

const defineLateBoundSignalRef = <T extends object>(
  value: T,
  ref: LateBoundSignalRef
): T => {
  Object.defineProperty(value, LATE_BOUND_SIGNAL_REF, {
    configurable: false,
    enumerable: false,
    value: ref,
    writable: false,
  });
  return value;
};

export const getLateBoundSignalRef = (
  signal: Pick<AnySignal, 'id'> | undefined
): LateBoundSignalRef | undefined =>
  signal === undefined
    ? undefined
    : ((signal as Record<PropertyKey, unknown>)[LATE_BOUND_SIGNAL_REF] as
        | LateBoundSignalRef
        | undefined);

export const attachLateBoundSignalRef = <T>(
  signal: Signal<T>,
  ref: LateBoundSignalRef
): Signal<T> =>
  Object.freeze(
    defineLateBoundSignalRef(
      {
        ...signal,
      },
      ref
    )
  ) as Signal<T>;

export const cloneSignalWithId = <T>(
  signal: Signal<T>,
  id: string
): Signal<T> => {
  const clone = {
    ...signal,
    id,
  };
  const ref = getLateBoundSignalRef(signal);
  return Object.freeze(
    ref ? defineLateBoundSignalRef(clone, ref) : clone
  ) as Signal<T>;
};

export const createLateBoundSignalMarker = (
  ref: LateBoundSignalRef,
  displayId: string
): string => `${LATE_BOUND_SIGNAL_MARKER_PREFIX}${ref.token}:${displayId}`;

export const parseLateBoundSignalMarker = (
  value: string
): LateBoundSignalMarker | null => {
  if (!value.startsWith(LATE_BOUND_SIGNAL_MARKER_PREFIX)) {
    return null;
  }

  const remainder = value.slice(LATE_BOUND_SIGNAL_MARKER_PREFIX.length);
  const separator = remainder.indexOf(':');
  if (separator <= 0 || separator === remainder.length - 1) {
    return null;
  }

  return {
    displayId: remainder.slice(separator + 1),
    token: remainder.slice(0, separator),
  };
};
