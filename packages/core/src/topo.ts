/**
 * Application entry point — scans module exports to build a topology graph.
 */

import { ValidationError } from './errors.js';
import type { AnySignal } from './event.js';
import type { AnyProvision } from './provision.js';
import { isProvision } from './provision.js';
import type { AnyTrail } from './trail.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Topo {
  readonly name: string;
  readonly trails: ReadonlyMap<string, AnyTrail>;
  readonly signals: ReadonlyMap<string, AnySignal>;
  readonly provisions: ReadonlyMap<string, AnyProvision>;
  readonly count: number;
  readonly provisionCount: number;
  get(id: string): AnyTrail | undefined;
  getProvision(id: string): AnyProvision | undefined;
  has(id: string): boolean;
  hasProvision(id: string): boolean;
  ids(): string[];
  provisionIds(): string[];
  list(): AnyTrail[];
  listSignals(): AnySignal[];
  listProvisions(): AnyProvision[];
}

// ---------------------------------------------------------------------------
// Kind discriminant check
// ---------------------------------------------------------------------------

type Registrable = AnyTrail | AnySignal | AnyProvision;

const isRegistrable = (value: unknown): value is Registrable => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { kind } = value as Record<string, unknown>;
  return kind === 'trail' || kind === 'signal';
};

// ---------------------------------------------------------------------------
// Topo implementation
// ---------------------------------------------------------------------------

const createTopo = (
  name: string,
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>,
  provisions: ReadonlyMap<string, AnyProvision>
): Topo => ({
  count: trails.size,
  get(id: string): AnyTrail | undefined {
    return trails.get(id);
  },
  getProvision(id: string): AnyProvision | undefined {
    return provisions.get(id);
  },
  has(id: string): boolean {
    return trails.has(id);
  },
  hasProvision(id: string): boolean {
    return provisions.has(id);
  },
  ids(): string[] {
    return [...trails.keys()];
  },

  list(): AnyTrail[] {
    return [...trails.values()];
  },
  listProvisions(): AnyProvision[] {
    return [...provisions.values()];
  },

  listSignals(): AnySignal[] {
    return [...signals.values()];
  },

  name,
  provisionCount: provisions.size,

  provisionIds(): string[] {
    return [...provisions.keys()];
  },
  provisions,
  signals,
  trails,
});

// ---------------------------------------------------------------------------
// topo()
// ---------------------------------------------------------------------------

/** Register a single registrable value into the appropriate map. */
const register = (
  value: Registrable,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  provisions: Map<string, AnyProvision>
): void => {
  const { id } = value as { id: string };
  const registrars: Record<string, () => void> = {
    provision: () => {
      if (provisions.has(id)) {
        throw new ValidationError(`Duplicate provision ID: "${id}"`);
      }
      provisions.set(id, value as AnyProvision);
    },
    signal: () => {
      if (signals.has(id)) {
        throw new ValidationError(`Duplicate signal ID: "${id}"`);
      }
      signals.set(id, value as AnySignal);
    },
    trail: () => {
      if (trails.has(id)) {
        throw new ValidationError(`Duplicate trail ID: "${id}"`);
      }
      trails.set(id, value as AnyTrail);
    },
  };
  registrars[value.kind]?.();
};

const markUniqueObject = (
  value: unknown,
  seenValues: WeakSet<object>
): boolean => {
  if (typeof value !== 'object' || value === null) {
    return true;
  }
  if (seenValues.has(value)) {
    return false;
  }
  seenValues.add(value);
  return true;
};

const registerModuleValue = (
  value: unknown,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  provisions: Map<string, AnyProvision>
): void => {
  if (isProvision(value) || isRegistrable(value)) {
    register(value, trails, signals, provisions);
  }
};

const registerModuleValues = (
  mod: Record<string, unknown>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  provisions: Map<string, AnyProvision>
): void => {
  const seenValues = new WeakSet<object>();
  for (const value of Object.values(mod)) {
    if (!markUniqueObject(value, seenValues)) {
      continue;
    }
    registerModuleValue(value, trails, signals, provisions);
  }
};

export const topo = (
  name: string,
  ...modules: Record<string, unknown>[]
): Topo => {
  const trails = new Map<string, AnyTrail>();
  const signals = new Map<string, AnySignal>();
  const provisions = new Map<string, AnyProvision>();

  for (const mod of modules) {
    registerModuleValues(mod, trails, signals, provisions);
  }

  return createTopo(name, trails, signals, provisions);
};
