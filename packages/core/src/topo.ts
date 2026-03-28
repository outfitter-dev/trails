/**
 * Application entry point — scans module exports to build a topology graph.
 */

import { ValidationError } from './errors.js';
import type { AnyEvent } from './event.js';
import type { AnyTrail } from './trail.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Topo {
  readonly name: string;
  readonly trails: ReadonlyMap<string, AnyTrail>;
  readonly events: ReadonlyMap<string, AnyEvent>;
  get(id: string): AnyTrail | undefined;
  has(id: string): boolean;
  list(): AnyTrail[];
  listEvents(): AnyEvent[];
}

// ---------------------------------------------------------------------------
// Kind discriminant check
// ---------------------------------------------------------------------------

type Registrable = AnyTrail | AnyEvent;

const isRegistrable = (value: unknown): value is Registrable => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { kind } = value as Record<string, unknown>;
  return kind === 'trail' || kind === 'event';
};

// ---------------------------------------------------------------------------
// Topo implementation
// ---------------------------------------------------------------------------

const createTopo = (
  name: string,
  trails: ReadonlyMap<string, AnyTrail>,
  events: ReadonlyMap<string, AnyEvent>
): Topo => ({
  events,
  get(id: string): AnyTrail | undefined {
    return trails.get(id);
  },
  has(id: string): boolean {
    return trails.has(id);
  },

  list(): AnyTrail[] {
    return [...trails.values()];
  },

  listEvents(): AnyEvent[] {
    return [...events.values()];
  },

  name,

  trails,
});

// ---------------------------------------------------------------------------
// topo()
// ---------------------------------------------------------------------------

/** Register a single registrable value into the appropriate map. */
const register = (
  value: Registrable,
  trails: Map<string, AnyTrail>,
  events: Map<string, AnyEvent>
): void => {
  const { id } = value as { id: string };
  const registrars: Record<string, () => void> = {
    event: () => {
      if (events.has(id)) {
        throw new ValidationError(`Duplicate event ID: "${id}"`);
      }
      events.set(id, value as AnyEvent);
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

export const topo = (
  name: string,
  ...modules: Record<string, unknown>[]
): Topo => {
  const trails = new Map<string, AnyTrail>();
  const events = new Map<string, AnyEvent>();

  for (const mod of modules) {
    for (const value of Object.values(mod)) {
      if (isRegistrable(value)) {
        register(value, trails, events);
      }
    }
  }

  return createTopo(name, trails, events);
};
