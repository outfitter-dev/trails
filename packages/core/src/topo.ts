/**
 * Application entry point — scans module exports to build a topology graph.
 */

import { ValidationError } from './errors.js';
import type { AnySignal } from './event.js';
import type { AnyResource } from './resource.js';
import { isResource } from './resource.js';
import type { AnyTrail } from './trail.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Topo {
  readonly name: string;
  readonly trails: ReadonlyMap<string, AnyTrail>;
  readonly signals: ReadonlyMap<string, AnySignal>;
  readonly resources: ReadonlyMap<string, AnyResource>;
  readonly count: number;
  readonly resourceCount: number;
  get(id: string): AnyTrail | undefined;
  getResource(id: string): AnyResource | undefined;
  has(id: string): boolean;
  hasResource(id: string): boolean;
  ids(): string[];
  resourceIds(): string[];
  list(): AnyTrail[];
  listSignals(): AnySignal[];
  listResources(): AnyResource[];
}

// ---------------------------------------------------------------------------
// Kind discriminant check
// ---------------------------------------------------------------------------

type Registrable = AnyTrail | AnySignal | AnyResource;

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
  resources: ReadonlyMap<string, AnyResource>
): Topo => ({
  count: trails.size,
  get(id: string): AnyTrail | undefined {
    return trails.get(id);
  },
  getResource(id: string): AnyResource | undefined {
    return resources.get(id);
  },
  has(id: string): boolean {
    return trails.has(id);
  },
  hasResource(id: string): boolean {
    return resources.has(id);
  },
  ids(): string[] {
    return [...trails.keys()];
  },

  list(): AnyTrail[] {
    return [...trails.values()];
  },
  listResources(): AnyResource[] {
    return [...resources.values()];
  },

  listSignals(): AnySignal[] {
    return [...signals.values()];
  },

  name,
  resourceCount: resources.size,
  resourceIds(): string[] {
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
  resources: Map<string, AnyResource>
): void => {
  const { id } = value as { id: string };
  const registrars: Record<string, () => void> = {
    resource: () => {
      if (resources.has(id)) {
        throw new ValidationError(`Duplicate resource ID: "${id}"`);
      }
      resources.set(id, value as AnyResource);
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
  resources: Map<string, AnyResource>
): void => {
  if (isResource(value) || isRegistrable(value)) {
    register(value, trails, signals, resources);
  }
};

const registerModuleValues = (
  mod: Record<string, unknown>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyResource>
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
  const resources = new Map<string, AnyResource>();

  for (const mod of modules) {
    registerModuleValues(mod, trails, signals, resources);
  }

  return createTopo(name, trails, signals, resources);
};
