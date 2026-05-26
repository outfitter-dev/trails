import { DETOUR_MAX_ATTEMPTS_CAP } from './detours.js';
import { AmbiguousError, ValidationError } from './errors.js';
import { isPlainObject } from './guards.js';
import {
  getTrailVersionEntryKind,
  isArchivedTrailVersionEntry,
} from './trail.js';
import type { AnyTrail, TrailVersionEntry } from './trail.js';
import { zodToJsonSchema } from './validation.js';

export const TRAIL_VERSION_MARKER_LENGTH = 16;
export const TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH = 4;

export interface TrailVersionMarkerBinding {
  readonly marker: string;
  readonly version: number;
}

export interface TrailVersionMarkerResolution extends TrailVersionMarkerBinding {
  readonly prefix: string;
}

export interface TrailVersionMarkerRecord extends TrailVersionMarkerBinding {
  readonly current: boolean;
  readonly kind: 'current' | 'fork' | 'revision';
  readonly supported: boolean;
}

const markerPattern = /^[0-9a-f]{16}$/;
const markerPrefixPattern = /^[0-9a-f]+$/;

const markerValuePath = (path: readonly string[]): string =>
  path.length === 0 ? '<root>' : path.join('.');

const assertMarkerContentSupported = (
  value: unknown,
  path: readonly string[] = []
): void => {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertMarkerContentSupported(entry, [...path, String(index)]);
    }
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0 && path.at(-1) !== 'properties') {
    throw new ValidationError(
      `Trail version marker content at ${markerValuePath(path)} contains an unsupported empty schema projection`
    );
  }

  for (const key of keys) {
    assertMarkerContentSupported(record[key], [...path, key]);
  }
};

const canonicalizeMarkerValue = (
  value: unknown,
  path: readonly string[],
  seen: WeakSet<object>
): unknown => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      canonicalizeMarkerValue(entry, [...path, String(index)], seen)
    );
  }

  if (value === undefined) {
    throw new ValidationError(
      `Trail version marker content cannot contain undefined at ${markerValuePath(path)}`
    );
  }

  if (typeof value === 'bigint' || typeof value === 'function') {
    throw new ValidationError(
      `Trail version marker content cannot contain ${typeof value} at ${markerValuePath(path)}`
    );
  }

  if (typeof value === 'symbol') {
    throw new ValidationError(
      `Trail version marker content cannot contain symbol at ${markerValuePath(path)}`
    );
  }

  if (!isPlainObject(value)) {
    throw new ValidationError(
      `Trail version marker content must be JSON-compatible at ${markerValuePath(path)}`
    );
  }

  if (seen.has(value)) {
    throw new ValidationError(
      `Trail version marker content cannot contain circular references at ${markerValuePath(path)}`
    );
  }
  seen.add(value);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    const next = value[key];
    if (next !== undefined) {
      sorted[key] = canonicalizeMarkerValue(next, [...path, key], seen);
    }
  }

  seen.delete(value);
  return sorted;
};

export const canonicalizeTrailVersionMarkerContent = (
  content: unknown
): unknown => canonicalizeMarkerValue(content, [], new WeakSet<object>());

export const deriveTrailVersionMarker = (content: unknown): string => {
  assertMarkerContentSupported(content);
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(JSON.stringify(canonicalizeTrailVersionMarkerContent(content)));
  return hasher.digest('hex').slice(0, TRAIL_VERSION_MARKER_LENGTH);
};

const projectSchema = (schema: unknown): unknown =>
  canonicalizeTrailVersionMarkerContent(zodToJsonSchema(schema as never));

const projectVersionDetours = (
  entry: unknown
): readonly Record<string, unknown>[] | undefined => {
  const raw = entry as unknown as Record<string, unknown>;
  const { detours } = raw;
  if (!Array.isArray(detours) || detours.length === 0) {
    return undefined;
  }

  return detours.map((detour) => {
    const candidate = detour as {
      readonly maxAttempts?: number | undefined;
      readonly on?: { readonly name?: string | undefined } | undefined;
    };
    return {
      maxAttempts: Math.max(
        1,
        Math.min(candidate.maxAttempts ?? 1, DETOUR_MAX_ATTEMPTS_CAP)
      ),
      on: candidate.on?.name ?? 'Error',
    };
  });
};

const projectVersionRuntimeRefs = (
  entry: unknown,
  field: 'composes' | 'resources'
): readonly string[] | undefined => {
  const raw = entry as unknown as Record<string, unknown>;
  const values = raw[field];
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }

  const refs: string[] = [];
  for (const value of values) {
    if (typeof value === 'string') {
      refs.push(value);
      continue;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { readonly id?: unknown }).id === 'string'
    ) {
      refs.push((value as { readonly id: string }).id);
    }
  }

  return refs.toSorted();
};

export const deriveCurrentTrailVersionMarkerContent = (
  trail: Pick<
    AnyTrail,
    'composes' | 'detours' | 'input' | 'output' | 'resources'
  >
): Readonly<Record<string, unknown>> => {
  const content: Record<string, unknown> = {
    input: projectSchema(trail.input),
    kind: 'current',
    ...(trail.output === undefined
      ? {}
      : { output: projectSchema(trail.output) }),
  };

  const composes = projectVersionRuntimeRefs(trail, 'composes');
  const resources = projectVersionRuntimeRefs(trail, 'resources');
  const detours = projectVersionDetours(trail);
  if (composes !== undefined) {
    content['composes'] = composes;
  }
  if (resources !== undefined) {
    content['resources'] = resources;
  }
  if (detours !== undefined) {
    content['detours'] = detours;
  }

  return content;
};

export const deriveTrailVersionEntryMarkerContent = (
  entry: TrailVersionEntry
): Readonly<Record<string, unknown>> => {
  const kind = getTrailVersionEntryKind(entry);
  const content: Record<string, unknown> = {
    input: projectSchema(entry.input),
    kind,
    output: projectSchema(entry.output),
  };

  if (kind === 'revision' && entry.transpose !== undefined) {
    content['transpose'] = { input: true, output: true };
  }

  if (kind === 'fork') {
    const composes = projectVersionRuntimeRefs(entry, 'composes');
    const resources = projectVersionRuntimeRefs(entry, 'resources');
    const detours = projectVersionDetours(entry);
    if (composes !== undefined) {
      content['composes'] = composes;
    }
    if (resources !== undefined) {
      content['resources'] = resources;
    }
    if (detours !== undefined) {
      content['detours'] = detours;
    }
  }

  return content;
};

export const deriveCurrentTrailVersionMarker = (
  trail: Pick<
    AnyTrail,
    'composes' | 'detours' | 'input' | 'output' | 'resources'
  >
): string =>
  deriveTrailVersionMarker(deriveCurrentTrailVersionMarkerContent(trail));

export const deriveTrailVersionEntryMarker = (
  entry: TrailVersionEntry
): string =>
  deriveTrailVersionMarker(deriveTrailVersionEntryMarkerContent(entry));

export const assertTrailVersionMarker = (marker: string): void => {
  if (!markerPattern.test(marker)) {
    throw new ValidationError(
      `Trail version marker must be a ${TRAIL_VERSION_MARKER_LENGTH}-character lowercase SHA-256 prefix`
    );
  }
};

export const normalizeTrailVersionMarkerPrefix = (prefix: string): string => {
  const normalized = prefix.toLowerCase();
  if (
    normalized.length < TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH ||
    normalized.length > TRAIL_VERSION_MARKER_LENGTH ||
    !markerPrefixPattern.test(normalized)
  ) {
    throw new ValidationError(
      `Trail version marker prefix must be ${TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH}-${TRAIL_VERSION_MARKER_LENGTH} lowercase hexadecimal characters`
    );
  }
  return normalized;
};

export const assertUniqueTrailVersionMarkers = (
  trailId: string,
  markers: readonly TrailVersionMarkerBinding[]
): void => {
  const byMarker = new Map<string, number[]>();
  for (const { marker, version } of markers) {
    assertTrailVersionMarker(marker);
    const versions = byMarker.get(marker) ?? [];
    versions.push(version);
    byMarker.set(marker, versions);
  }

  for (const [marker, versions] of byMarker) {
    if (versions.length > 1) {
      throw new ValidationError(
        `Trail "${trailId}" versions ${versions.join(', ')} project the same marker ${marker}`
      );
    }
  }
};

export const deriveTrailVersionMarkers = (
  trail: Pick<
    AnyTrail,
    | 'composes'
    | 'detours'
    | 'id'
    | 'input'
    | 'output'
    | 'resources'
    | 'version'
    | 'versions'
  >
): readonly TrailVersionMarkerRecord[] => {
  if (trail.version === undefined) {
    return [];
  }

  const records: TrailVersionMarkerRecord[] = [
    {
      current: true,
      kind: 'current',
      marker: deriveCurrentTrailVersionMarker(trail),
      supported: true,
      version: trail.version,
    },
  ];

  for (const [rawVersion, entry] of Object.entries(
    trail.versions ?? {}
  ).toSorted(([left], [right]) => Number(left) - Number(right))) {
    const kind = getTrailVersionEntryKind(entry);
    records.push({
      current: false,
      kind,
      marker: deriveTrailVersionEntryMarker(entry),
      supported: !isArchivedTrailVersionEntry(entry),
      version: Number(rawVersion),
    });
  }

  assertUniqueTrailVersionMarkers(trail.id, records);
  return Object.freeze(records);
};

export const deriveShortestUnambiguousTrailVersionMarkerPrefix = (
  marker: string,
  markers: readonly string[],
  minLength = TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH
): string => {
  assertTrailVersionMarker(marker);
  const normalizedMarkers = markers.map((candidate) => {
    assertTrailVersionMarker(candidate);
    return candidate;
  });
  if (!normalizedMarkers.includes(marker)) {
    throw new ValidationError(
      `Trail version marker ${marker} is not in the provided marker set`
    );
  }

  for (
    let length = Math.max(minLength, TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH);
    length <= TRAIL_VERSION_MARKER_LENGTH;
    length += 1
  ) {
    const prefix = marker.slice(0, length);
    const matches = normalizedMarkers.filter((candidate) =>
      candidate.startsWith(prefix)
    );
    if (matches.length === 1) {
      return prefix;
    }
  }

  throw new AmbiguousError(
    `Trail version marker ${marker} has no unambiguous display prefix`
  );
};

export const resolveTrailVersionMarkerPrefix = (
  markers: readonly TrailVersionMarkerBinding[],
  prefix: string
): TrailVersionMarkerResolution => {
  const normalized = normalizeTrailVersionMarkerPrefix(prefix);
  const matches = markers.filter((candidate) =>
    candidate.marker.startsWith(normalized)
  );

  if (matches.length === 0) {
    throw new ValidationError(
      `No trail version marker matches prefix ${normalized}`
    );
  }

  if (matches.length > 1) {
    throw new AmbiguousError(
      `Trail version marker prefix ${normalized} is ambiguous across versions ${matches.map((candidate) => candidate.version).join(', ')}`
    );
  }

  const [match] = matches;
  if (match === undefined) {
    throw new ValidationError(
      `No trail version marker matches prefix ${normalized}`
    );
  }

  return { ...match, prefix: normalized };
};
