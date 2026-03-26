/**
 * Application entry point — scans module exports to build a topology graph.
 */

import { ValidationError } from './errors.js';
import type { AnyEvent } from './event.js';
import type { AnyHike } from './hike.js';
import type { AnyTrail } from './trail.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Topo {
  readonly name: string;
  readonly trails: ReadonlyMap<string, AnyTrail>;
  readonly hikes: ReadonlyMap<string, AnyHike>;
  readonly events: ReadonlyMap<string, AnyEvent>;
  get(id: string): AnyTrail | AnyHike | undefined;
  has(id: string): boolean;
  list(): (AnyTrail | AnyHike)[];
  listEvents(): AnyEvent[];
}

// ---------------------------------------------------------------------------
// Kind discriminant check
// ---------------------------------------------------------------------------

type Registrable = AnyTrail | AnyHike | AnyEvent;

const isRegistrable = (value: unknown): value is Registrable => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { kind } = value as Record<string, unknown>;
  return kind === 'trail' || kind === 'hike' || kind === 'event';
};

// ---------------------------------------------------------------------------
// Topo implementation
// ---------------------------------------------------------------------------

const createTopo = (
  name: string,
  trails: ReadonlyMap<string, AnyTrail>,
  hikes: ReadonlyMap<string, AnyHike>,
  events: ReadonlyMap<string, AnyEvent>
): Topo => ({
  events,
  get(id: string): AnyTrail | AnyHike | undefined {
    return trails.get(id) ?? hikes.get(id);
  },
  has(id: string): boolean {
    return trails.has(id) || hikes.has(id);
  },
  hikes,

  list(): (AnyTrail | AnyHike)[] {
    return [...trails.values(), ...hikes.values()];
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
  hikes: Map<string, AnyHike>,
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
    hike: () => {
      if (hikes.has(id)) {
        throw new ValidationError(`Duplicate hike ID: "${id}"`);
      }
      hikes.set(id, value as AnyHike);
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
  const hikes = new Map<string, AnyHike>();
  const events = new Map<string, AnyEvent>();

  for (const mod of modules) {
    for (const value of Object.values(mod)) {
      if (isRegistrable(value)) {
        register(value, trails, hikes, events);
      }
    }
  }

  return createTopo(name, trails, hikes, events);
};
