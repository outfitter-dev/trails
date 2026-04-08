/**
 * Application entry point — scans module exports to build a topology graph.
 */

import { ValidationError } from './errors.js';
import type { AnySignal } from './event.js';
import type { AnyProvision } from './resource.js';
import { isProvision } from './resource.js';
import type { AnyTrail } from './trail.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Topo {
  readonly name: string;
  readonly trails: ReadonlyMap<string, AnyTrail>;
  readonly signals: ReadonlyMap<string, AnySignal>;
  readonly resources: ReadonlyMap<string, AnyProvision>;
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
  resources: ReadonlyMap<string, AnyProvision>
): Topo => ({
  count: trails.size,
  get(id: string): AnyTrail | undefined {
    return trails.get(id);
  },
  getProvision(id: string): AnyProvision | undefined {
    return resources.get(id);
  },
  has(id: string): boolean {
    return trails.has(id);
  },
  hasProvision(id: string): boolean {
    return resources.has(id);
  },
  ids(): string[] {
    return [...trails.keys()];
  },

  list(): AnyTrail[] {
    return [...trails.values()];
  },
  listProvisions(): AnyProvision[] {
    return [...resources.values()];
  },

  listSignals(): AnySignal[] {
    return [...signals.values()];
  },

  name,
  provisionCount: resources.size,

  provisionIds(): string[] {
    return [...resources.keys()];
  },
  resources,
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
  resources: Map<string, AnyProvision>
): void => {
  const { id } = value as { id: string };
  const registrars: Record<string, () => void> = {
    resource: () => {
      if (resources.has(id)) {
        throw new ValidationError(`Duplicate resource ID: "${id}"`);
      }
      resources.set(id, value as AnyProvision);
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
  resources: Map<string, AnyProvision>
): void => {
  if (isProvision(value) || isRegistrable(value)) {
    register(value, trails, signals, resources);
  }
};

const registerModuleValues = (
  mod: Record<string, unknown>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyProvision>
): void => {
  const seenValues = new WeakSet<object>();
  for (const value of Object.values(mod)) {
    if (!markUniqueObject(value, seenValues)) {
      continue;
    }
    registerModuleValue(value, trails, signals, resources);
  }
};

export const topo = (
  name: string,
  ...modules: Record<string, unknown>[]
): Topo => {
  const trails = new Map<string, AnyTrail>();
  const signals = new Map<string, AnySignal>();
  const resources = new Map<string, AnyProvision>();

  for (const mod of modules) {
    registerModuleValues(mod, trails, signals, resources);
  }

  return createTopo(name, trails, signals, resources);
};
