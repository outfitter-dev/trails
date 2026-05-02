/**
 * Application entry point — scans module exports to build a topology graph.
 */

import type { AnyContour } from './contour.js';
import { ValidationError } from './errors.js';
import type { ActivationEntry } from './activation-source.js';
import {
  getLateBoundSignalRef,
  parseLateBoundSignalMarker,
} from './internal/signal-ref.js';
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

const registerLateBoundSignalId = (
  byToken: Map<string, Set<string>>,
  signal: AnySignal
): void => {
  const ref = getLateBoundSignalRef(signal);
  if (!ref) {
    return;
  }

  const ids = byToken.get(ref.token) ?? new Set<string>();
  ids.add(signal.id);
  byToken.set(ref.token, ids);
};

const collectLateBoundSignalIdsByToken = (
  resources: ReadonlyMap<string, AnyResource>
): ReadonlyMap<string, readonly string[]> => {
  const byToken = new Map<string, Set<string>>();

  for (const resource of resources.values()) {
    for (const signal of resource.signals ?? []) {
      registerLateBoundSignalId(byToken, signal);
    }
  }

  return new Map(
    [...byToken.entries()].map(([token, ids]) => [token, [...ids]])
  );
};

const resolveLateBoundSignalId = (
  trailId: string,
  signalId: string,
  lateBoundSignalIdsByToken: ReadonlyMap<string, readonly string[]>
): string => {
  const marker = parseLateBoundSignalMarker(signalId);
  if (!marker) {
    return signalId;
  }

  const matches = lateBoundSignalIdsByToken.get(marker.token) ?? [];
  if (matches.length === 1) {
    return matches[0] ?? signalId;
  }

  if (matches.length === 0) {
    // Intentional throw: split-topo composition (where a trail and the
    // store that backs its signals live in different topos) is not yet
    // supported. Failing loudly here surfaces the case at assembly time
    // instead of silently producing a trail with an unresolved store
    // reference that would misbehave at runtime.
    throw new ValidationError(
      `Trail "${trailId}" references store-derived signal "${marker.displayId}", but no resource bound in this topo exposes it. ` +
        'This usually means the store that backs this signal is not bound in this topo. ' +
        `Bind the store via resource() in the same topo() call as "${trailId}", or compose this topo with the topo that binds the store. ` +
        'Splitting a trail and its backing store across independent topos is not yet supported.'
    );
  }

  throw new ValidationError(
    `Trail "${trailId}" references late-bound signal "${marker.displayId}" but it resolves to multiple bound resource signals: ${matches.join(', ')}. Use canonical scoped ids when the same store definition is bound more than once.`
  );
};

const resolveTrailSignalIds = (
  trailId: string,
  signalIds: readonly string[],
  lateBoundSignalIdsByToken: ReadonlyMap<string, readonly string[]>
): { changed: boolean; ids: readonly string[] } => {
  let changed = false;
  const ids = Object.freeze(
    signalIds.map((signalId) => {
      const resolved = resolveLateBoundSignalId(
        trailId,
        signalId,
        lateBoundSignalIdsByToken
      );
      changed ||= resolved !== signalId;
      return resolved;
    })
  );

  return { changed, ids };
};

const resolveTrailActivationSources = (
  trailId: string,
  activations: readonly ActivationEntry[],
  lateBoundSignalIdsByToken: ReadonlyMap<string, readonly string[]>
): { changed: boolean; activations: readonly ActivationEntry[] } => {
  let changed = false;
  const resolved = Object.freeze(
    activations.map((entry) => {
      if (entry.source.kind !== 'signal') {
        return entry;
      }

      const resolvedId = resolveLateBoundSignalId(
        trailId,
        entry.source.id,
        lateBoundSignalIdsByToken
      );
      if (resolvedId === entry.source.id) {
        return entry;
      }

      changed = true;
      return Object.freeze({
        ...entry,
        source: Object.freeze({ ...entry.source, id: resolvedId }),
      });
    })
  );

  return { activations: resolved, changed };
};

const finalizeTrailSignals = (
  trails: ReadonlyMap<string, AnyTrail>,
  resources: ReadonlyMap<string, AnyResource>
): Map<string, AnyTrail> => {
  const lateBoundSignalIdsByToken = collectLateBoundSignalIdsByToken(resources);
  const finalized = new Map<string, AnyTrail>();

  for (const trail of trails.values()) {
    const resolvedFires = resolveTrailSignalIds(
      trail.id,
      trail.fires ?? [],
      lateBoundSignalIdsByToken
    );
    const resolvedOn = resolveTrailSignalIds(
      trail.id,
      trail.on ?? [],
      lateBoundSignalIdsByToken
    );
    const resolvedActivationSources = resolveTrailActivationSources(
      trail.id,
      trail.activationSources ?? [],
      lateBoundSignalIdsByToken
    );

    if (
      !resolvedFires.changed &&
      !resolvedOn.changed &&
      !resolvedActivationSources.changed
    ) {
      finalized.set(trail.id, trail);
      continue;
    }

    finalized.set(
      trail.id,
      Object.freeze({
        ...trail,
        activationSources: resolvedActivationSources.activations,
        fires: resolvedFires.ids,
        on: resolvedOn.ids,
      })
    );
  }

  return finalized;
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

  return createTopo(
    identity,
    contours,
    finalizeTrailSignals(trails, resources),
    signals,
    resources
  );
};
