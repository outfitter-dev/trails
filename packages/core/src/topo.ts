/**
 * Application entry point — scans module exports to build a topology graph.
 */

import type { AnyContour } from './contour.js';
import { ValidationError } from './errors.js';
import type { AnySignal } from './signal.js';
import type { AnyResource } from './resource.js';
import { isResource } from './resource.js';
import type { AnyTrail } from './trail.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TopoIdentity {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
}

export interface Topo {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly contours: ReadonlyMap<string, AnyContour>;
  readonly trails: ReadonlyMap<string, AnyTrail>;
  readonly signals: ReadonlyMap<string, AnySignal>;
  readonly resources: ReadonlyMap<string, AnyResource>;
  readonly count: number;
  readonly contourCount: number;
  readonly resourceCount: number;
  getContour(name: string): AnyContour | undefined;
  get(id: string): AnyTrail | undefined;
  getResource(id: string): AnyResource | undefined;
  hasContour(name: string): boolean;
  has(id: string): boolean;
  hasResource(id: string): boolean;
  contourIds(): string[];
  ids(): string[];
  resourceIds(): string[];
  listContours(): AnyContour[];
  list(): AnyTrail[];
  listSignals(): AnySignal[];
  listResources(): AnyResource[];
}

// ---------------------------------------------------------------------------
// Kind discriminant check
// ---------------------------------------------------------------------------

type Registrable = AnyContour | AnyTrail | AnySignal | AnyResource;

const isRegistrable = (value: unknown): value is Registrable => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { kind } = value as Record<string, unknown>;
  return kind === 'contour' || kind === 'trail' || kind === 'signal';
};

// ---------------------------------------------------------------------------
// Topo implementation
// ---------------------------------------------------------------------------

const createTopo = (
  identity: TopoIdentity,
  contours: ReadonlyMap<string, AnyContour>,
  trails: ReadonlyMap<string, AnyTrail>,
  signals: ReadonlyMap<string, AnySignal>,
  resources: ReadonlyMap<string, AnyResource>
): Topo => ({
  contourCount: contours.size,
  contourIds(): string[] {
    return [...contours.keys()];
  },
  contours,
  count: trails.size,
  get(id: string): AnyTrail | undefined {
    return trails.get(id);
  },
  getContour(contourName: string): AnyContour | undefined {
    return contours.get(contourName);
  },
  getResource(id: string): AnyResource | undefined {
    return resources.get(id);
  },
  has(id: string): boolean {
    return trails.has(id);
  },
  hasContour(contourName: string): boolean {
    return contours.has(contourName);
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
  listContours(): AnyContour[] {
    return [...contours.values()];
  },
  listResources(): AnyResource[] {
    return [...resources.values()];
  },

  listSignals(): AnySignal[] {
    return [...signals.values()];
  },

  name: identity.name,
  ...(identity.version !== undefined && { version: identity.version }),
  ...(identity.description !== undefined && {
    description: identity.description,
  }),
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

const registerUnique = <T>(
  collection: Map<string, T>,
  id: string,
  value: T,
  duplicateMessage: string
): void => {
  const existing = collection.get(id);
  if (existing === value) {
    return;
  }
  if (existing !== undefined) {
    throw new ValidationError(duplicateMessage);
  }
  collection.set(id, value);
};

const registerContour = (
  contour: AnyContour,
  contours: Map<string, AnyContour>
): void => {
  registerUnique(
    contours,
    contour.name,
    contour,
    `Duplicate contour name: "${contour.name}"`
  );
};

const registerResourceValue = (
  resource: AnyResource,
  resources: Map<string, AnyResource>
): void => {
  registerUnique(
    resources,
    resource.id,
    resource,
    `Duplicate resource ID: "${resource.id}"`
  );
};

const registerSignal = (
  signal: AnySignal,
  signals: Map<string, AnySignal>
): void => {
  registerUnique(
    signals,
    signal.id,
    signal,
    `Duplicate signal ID: "${signal.id}"`
  );
};

const registerResourceSignals = (
  resource: AnyResource,
  signals: Map<string, AnySignal>
): void => {
  for (const derived of resource.signals ?? []) {
    registerSignal(derived, signals);
  }
};

const registerTrail = (
  trail: AnyTrail,
  trails: Map<string, AnyTrail>
): void => {
  registerUnique(trails, trail.id, trail, `Duplicate trail ID: "${trail.id}"`);
};

/** Register a single registrable value into the appropriate map. */
const register = (
  value: Registrable,
  contours: Map<string, AnyContour>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyResource>
): void => {
  switch (value.kind) {
    case 'contour': {
      registerContour(value as AnyContour, contours);
      break;
    }
    case 'resource': {
      registerResourceValue(value as AnyResource, resources);
      break;
    }
    case 'signal': {
      registerSignal(value as AnySignal, signals);
      break;
    }
    case 'trail': {
      registerTrail(value as AnyTrail, trails);
      break;
    }
    default: {
      throw new ValidationError('Unsupported registrable value in topo()');
    }
  }
};

const registerTrailContours = (
  trail: AnyTrail,
  contours: Map<string, AnyContour>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyResource>
): void => {
  for (const contour of trail.contours ?? []) {
    register(contour, contours, trails, signals, resources);
  }
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
  contours: Map<string, AnyContour>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyResource>
): void => {
  if (isResource(value) || isRegistrable(value)) {
    register(value, contours, trails, signals, resources);
  }

  if (isResource(value)) {
    registerResourceSignals(value, signals);
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'trail'
  ) {
    registerTrailContours(
      value as AnyTrail,
      contours,
      trails,
      signals,
      resources
    );
  }
};

const registerModuleValues = (
  mod: Record<string, unknown>,
  contours: Map<string, AnyContour>,
  trails: Map<string, AnyTrail>,
  signals: Map<string, AnySignal>,
  resources: Map<string, AnyResource>
): void => {
  const seenValues = new WeakSet<object>();
  for (const value of Object.values(mod)) {
    if (!markUniqueObject(value, seenValues)) {
      continue;
    }
    registerModuleValue(value, contours, trails, signals, resources);
  }
};

export const topo = (
  nameOrIdentity: string | TopoIdentity,
  ...modules: Record<string, unknown>[]
): Topo => {
  const identity: TopoIdentity =
    typeof nameOrIdentity === 'string'
      ? { name: nameOrIdentity }
      : nameOrIdentity;

  const contours = new Map<string, AnyContour>();
  const trails = new Map<string, AnyTrail>();
  const signals = new Map<string, AnySignal>();
  const resources = new Map<string, AnyResource>();

  for (const mod of modules) {
    registerModuleValues(mod, contours, trails, signals, resources);
  }

  return createTopo(identity, contours, trails, signals, resources);
};
