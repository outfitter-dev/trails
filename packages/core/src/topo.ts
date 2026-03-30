/**
 * Application entry point — scans module exports to build a topology graph.
 */

import { ValidationError } from './errors.js';
import type { AnyEvent } from './event.js';
import type { AnyService } from './service.js';
import { isService } from './service.js';
import type { AnyTrail } from './trail.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Topo {
  readonly name: string;
  readonly trails: ReadonlyMap<string, AnyTrail>;
  readonly events: ReadonlyMap<string, AnyEvent>;
  readonly services: ReadonlyMap<string, AnyService>;
  readonly count: number;
  readonly serviceCount: number;
  get(id: string): AnyTrail | undefined;
  getService(id: string): AnyService | undefined;
  has(id: string): boolean;
  hasService(id: string): boolean;
  ids(): string[];
  serviceIds(): string[];
  list(): AnyTrail[];
  listEvents(): AnyEvent[];
  listServices(): AnyService[];
}

// ---------------------------------------------------------------------------
// Kind discriminant check
// ---------------------------------------------------------------------------

type Registrable = AnyTrail | AnyEvent | AnyService;

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
  events: ReadonlyMap<string, AnyEvent>,
  services: ReadonlyMap<string, AnyService>
): Topo => ({
  count: trails.size,
  events,
  get(id: string): AnyTrail | undefined {
    return trails.get(id);
  },
  getService(id: string): AnyService | undefined {
    return services.get(id);
  },
  has(id: string): boolean {
    return trails.has(id);
  },
  hasService(id: string): boolean {
    return services.has(id);
  },

  ids(): string[] {
    return [...trails.keys()];
  },

  list(): AnyTrail[] {
    return [...trails.values()];
  },

  listEvents(): AnyEvent[] {
    return [...events.values()];
  },
  listServices(): AnyService[] {
    return [...services.values()];
  },

  name,
  serviceCount: services.size,
  serviceIds(): string[] {
    return [...services.keys()];
  },

  services,
  trails,
});

// ---------------------------------------------------------------------------
// topo()
// ---------------------------------------------------------------------------

/** Register a single registrable value into the appropriate map. */
const register = (
  value: Registrable,
  trails: Map<string, AnyTrail>,
  events: Map<string, AnyEvent>,
  services: Map<string, AnyService>
): void => {
  const { id } = value as { id: string };
  const registrars: Record<string, () => void> = {
    event: () => {
      if (events.has(id)) {
        throw new ValidationError(`Duplicate event ID: "${id}"`);
      }
      events.set(id, value as AnyEvent);
    },
    service: () => {
      if (services.has(id)) {
        throw new ValidationError(`Duplicate service ID: "${id}"`);
      }
      services.set(id, value as AnyService);
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

const registerModuleValues = (
  mod: Record<string, unknown>,
  trails: Map<string, AnyTrail>,
  events: Map<string, AnyEvent>,
  services: Map<string, AnyService>
): void => {
  for (const value of Object.values(mod)) {
    if (isService(value)) {
      register(value, trails, events, services);
      continue;
    }
    if (isRegistrable(value)) {
      register(value, trails, events, services);
    }
  }
};

export const topo = (
  name: string,
  ...modules: Record<string, unknown>[]
): Topo => {
  const trails = new Map<string, AnyTrail>();
  const events = new Map<string, AnyEvent>();
  const services = new Map<string, AnyService>();

  for (const mod of modules) {
    registerModuleValues(mod, trails, events, services);
  }

  return createTopo(name, trails, events, services);
};
