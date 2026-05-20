import {
  AmbiguousError,
  TrailsError,
  ValidationError,
  VersionNotSupportedError,
} from './errors.js';
import { Result } from './result.js';
import {
  deriveSupportedTrailVersions,
  getTrailVersionEntryKind,
  isArchivedTrailVersionEntry,
} from './trail.js';
import type {
  AnyTrail,
  TrailVersionForkEntry,
  TrailVersionRevisionEntry,
} from './trail.js';
import {
  TRAIL_VERSION_MARKER_LENGTH,
  TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH,
  deriveTrailVersionMarkers,
} from './version-marker.js';

export type TrailVersionReference = number | string;

export interface ParsedTrailVersionReference {
  readonly id: string;
  readonly version?: TrailVersionReference | undefined;
}

export type ResolvedTrailVersion =
  | {
      readonly current: true;
      readonly kind: 'current';
      readonly marker?: string | undefined;
      readonly version?: number | undefined;
    }
  | {
      readonly current: false;
      readonly deprecated: boolean;
      readonly entry: TrailVersionForkEntry;
      readonly kind: 'fork';
      readonly marker?: string | undefined;
      readonly version: number;
    }
  | {
      readonly current: false;
      readonly deprecated: boolean;
      readonly entry: TrailVersionRevisionEntry;
      readonly kind: 'revision';
      readonly marker?: string | undefined;
      readonly version: number;
    };

interface ParsedVersionReference {
  readonly display: number | string;
  readonly markerPrefix?: string | undefined;
  readonly number?: number | undefined;
}

type MarkerResolvableTrail = Pick<
  AnyTrail,
  | 'crosses'
  | 'detours'
  | 'id'
  | 'input'
  | 'output'
  | 'resources'
  | 'version'
  | 'versions'
>;

const versionRefPattern = /^(.+)@(.+)$/;
const positiveIntegerPattern = /^[1-9]\d*$/;
const markerPrefixPattern = /^[0-9a-fA-F]+$/;

const parsePositiveInteger = (value: string): number | undefined => {
  if (!positiveIntegerPattern.test(value)) {
    return undefined;
  }
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : undefined;
};

const isInlineVersionReference = (value: string): boolean =>
  parsePositiveInteger(value) !== undefined ||
  (value.length >= TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH &&
    value.length <= TRAIL_VERSION_MARKER_LENGTH &&
    markerPrefixPattern.test(value));

const unsupportedVersion = (
  trail: Pick<AnyTrail, 'id' | 'version' | 'versions'>,
  requested: number | string,
  reason: string
): VersionNotSupportedError => {
  const supported = deriveSupportedTrailVersions(trail);
  return new VersionNotSupportedError(trail.id, requested, supported, reason);
};

export const parseTrailIdVersionReference = (
  id: string
): Result<ParsedTrailVersionReference, ValidationError> => {
  const match = versionRefPattern.exec(id);
  if (match === null) {
    return Result.ok({ id });
  }

  const [, baseId, rawVersion] = match;
  if (baseId === undefined || rawVersion === undefined) {
    return Result.err(
      new ValidationError(
        'Trail version reference must use trail.id@N or trail.id@<marker-prefix>'
      )
    );
  }
  if (!isInlineVersionReference(rawVersion)) {
    return Result.ok({ id });
  }

  return Result.ok({ id: baseId, version: rawVersion });
};

const parseVersionReference = (
  reference: TrailVersionReference
): Result<ParsedVersionReference, Error> => {
  if (typeof reference === 'number') {
    return Number.isSafeInteger(reference) && reference > 0
      ? Result.ok({ display: reference, number: reference })
      : Result.err(
          new ValidationError(
            'Trail version reference must be a positive integer'
          )
        );
  }

  const markerRequested = reference.startsWith('@');
  const raw = markerRequested ? reference.slice(1) : reference;
  if (raw.length === 0) {
    return Result.err(
      new ValidationError('Trail version reference must not be empty')
    );
  }

  const number = parsePositiveInteger(raw);
  if (!markerRequested && number !== undefined) {
    return Result.ok({
      display: reference,
      markerPrefix:
        raw.length >= TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH &&
        raw.length <= TRAIL_VERSION_MARKER_LENGTH &&
        markerPrefixPattern.test(raw)
          ? raw.toLowerCase()
          : undefined,
      number,
    });
  }

  if (
    raw.length >= TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH &&
    raw.length <= TRAIL_VERSION_MARKER_LENGTH &&
    markerPrefixPattern.test(raw)
  ) {
    return Result.ok({
      display: reference,
      markerPrefix: raw.toLowerCase(),
    });
  }

  return Result.err(
    new ValidationError(
      'Trail version reference must be a positive integer or marker prefix'
    )
  );
};

const trailHasVersion = (
  trail: Pick<AnyTrail, 'version' | 'versions'>,
  version: number
): boolean =>
  trail.version === version || trail.versions?.[version] !== undefined;

const resolveMarkerReference = (
  trail: MarkerResolvableTrail,
  requested: number | string,
  prefix: string
): Result<{ readonly marker: string; readonly version: number }, Error> => {
  let records: ReturnType<typeof deriveTrailVersionMarkers>;
  try {
    records = deriveTrailVersionMarkers(trail);
  } catch (error: unknown) {
    return Result.err(
      error instanceof TrailsError
        ? error
        : new ValidationError(
            `Trail version marker derivation failed: ${String(error)}`
          )
    );
  }
  const matches = records.filter((record) => record.marker.startsWith(prefix));

  if (matches.length === 0) {
    return Result.err(unsupportedVersion(trail, requested, 'marker missing'));
  }
  if (matches.length > 1) {
    return Result.err(
      new AmbiguousError(
        `Trail version marker prefix ${prefix} is ambiguous across versions ${matches.map((record) => record.version).join(', ')}`
      )
    );
  }

  const match = matches[0] as (typeof matches)[number];

  return Result.ok({ marker: match.marker, version: match.version });
};

const resolveRequestedVersionNumber = (
  trail: MarkerResolvableTrail,
  reference: TrailVersionReference
): Result<
  { readonly marker?: string | undefined; readonly version: number },
  Error
> => {
  const parsed = parseVersionReference(reference);
  if (parsed.isErr()) {
    return parsed;
  }

  const { display, markerPrefix, number } = parsed.value;
  if (number !== undefined && trailHasVersion(trail, number)) {
    return Result.ok({ version: number });
  }

  if (markerPrefix !== undefined) {
    const marker = resolveMarkerReference(trail, display, markerPrefix);
    if (marker.isOk()) {
      return marker;
    }
    if (number === undefined) {
      return marker;
    }
  }

  return Result.err(unsupportedVersion(trail, display, 'missing'));
};

export const resolveTrailVersion = (
  trail: MarkerResolvableTrail,
  reference?: TrailVersionReference | undefined
): Result<ResolvedTrailVersion, Error> => {
  if (reference === undefined) {
    return Result.ok({
      current: true,
      kind: 'current',
      ...(trail.version === undefined ? {} : { version: trail.version }),
    });
  }

  if (trail.version === undefined) {
    return Result.err(unsupportedVersion(trail, reference, 'unversioned'));
  }

  const requested = resolveRequestedVersionNumber(trail, reference);
  if (requested.isErr()) {
    return requested;
  }

  if (requested.value.version === trail.version) {
    return Result.ok({
      current: true,
      kind: 'current',
      ...(requested.value.marker === undefined
        ? {}
        : { marker: requested.value.marker }),
      version: trail.version,
    });
  }

  const entry = trail.versions?.[requested.value.version];
  if (entry === undefined) {
    return Result.err(unsupportedVersion(trail, reference, 'missing'));
  }
  if (isArchivedTrailVersionEntry(entry)) {
    return Result.err(unsupportedVersion(trail, reference, 'archived'));
  }

  const kind = getTrailVersionEntryKind(entry);
  const base = {
    current: false,
    deprecated: entry.status?.state === 'deprecated',
    ...(requested.value.marker === undefined
      ? {}
      : { marker: requested.value.marker }),
    version: requested.value.version,
  } as const;

  return kind === 'fork'
    ? Result.ok({
        ...base,
        entry: entry as TrailVersionForkEntry,
        kind,
      })
    : Result.ok({
        ...base,
        entry: entry as TrailVersionRevisionEntry,
        kind,
      });
};
