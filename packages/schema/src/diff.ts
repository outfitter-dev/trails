/**
 * Semantic diffing of surface maps.
 */

import type {
  DiffEntry,
  DiffResult,
  JsonSchema,
  SurfaceMap,
  SurfaceMapEntry,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Severity = DiffEntry['severity'];

interface DetailAccumulator {
  readonly details: string[];
  severity: Severity;
}

const escalate = (acc: DetailAccumulator, severity: Severity): void => {
  const rank: Record<Severity, number> = { breaking: 2, info: 0, warning: 1 };
  if (rank[severity] > rank[acc.severity]) {
    acc.severity = severity;
  }
};

const addDetail = (
  acc: DetailAccumulator,
  severity: Severity,
  message: string
): void => {
  acc.details.push(message);
  escalate(acc, severity);
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const capitalize = (s: string): string =>
  `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

const labelForKind = (kind: SurfaceMapEntry['kind']): string => {
  if (kind === 'service') {
    return 'Service';
  }
  if (kind === 'event') {
    return 'Event';
  }
  return 'Trail';
};

// ---------------------------------------------------------------------------
// Schema field diffing
// ---------------------------------------------------------------------------

interface SchemaProperties {
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
}

const getProperties = (
  schema: JsonSchema | undefined
): Record<string, JsonSchema> => {
  if (!schema) {
    return {};
  }
  const props = (schema as SchemaProperties).properties;
  return props ? { ...props } : {};
};

const getRequired = (schema: JsonSchema | undefined): ReadonlySet<string> => {
  if (!schema) {
    return new Set();
  }
  const req = (schema as SchemaProperties).required;
  return new Set(req);
};

const inferSchemaType = (schema: JsonSchema): string => {
  if (typeof schema['type'] === 'string') {
    return schema['type'];
  }
  if (schema['const'] !== undefined) {
    return `const(${String(schema['const'])})`;
  }
  if (schema['anyOf']) {
    return 'union';
  }
  if (schema['enum']) {
    return 'enum';
  }
  return 'unknown';
};

const getType = (schema: JsonSchema | undefined): string =>
  schema ? inferSchemaType(schema) : 'unknown';

/** Diff a single field that was added. */
const diffAddedField = (
  acc: DetailAccumulator,
  direction: 'input' | 'output',
  key: string,
  currRequired: ReadonlySet<string>
): void => {
  if (direction === 'input' && currRequired.has(key)) {
    addDetail(acc, 'breaking', `Required ${direction} field "${key}" added`);
  } else {
    const label = direction === 'input' ? `Optional ${direction}` : 'Output';
    addDetail(acc, 'info', `${label} field "${key}" added`);
  }
};

/** Diff a single field present in both prev and curr. */
const diffModifiedField = (
  acc: DetailAccumulator,
  direction: 'input' | 'output',
  key: string,
  prevProps: Record<string, JsonSchema>,
  currProps: Record<string, JsonSchema>,
  prevRequired: ReadonlySet<string>,
  currRequired: ReadonlySet<string>
): void => {
  const prevType = getType(prevProps[key]);
  const currType = getType(currProps[key]);
  if (prevType !== currType) {
    addDetail(
      acc,
      'breaking',
      `${capitalize(direction)} field "${key}" type changed: ${prevType} -> ${currType}`
    );
  }
  if (
    direction === 'input' &&
    !prevRequired.has(key) &&
    currRequired.has(key)
  ) {
    addDetail(
      acc,
      'breaking',
      `Input field "${key}" changed from optional to required`
    );
  }
};

/** Diff a single key across prev/curr schemas. */
const diffKey = (
  acc: DetailAccumulator,
  direction: 'input' | 'output',
  key: string,
  prevProps: Record<string, JsonSchema>,
  currProps: Record<string, JsonSchema>,
  prevRequired: ReadonlySet<string>,
  currRequired: ReadonlySet<string>
): void => {
  const inPrev = key in prevProps;
  const inCurr = key in currProps;
  if (!inPrev && inCurr) {
    diffAddedField(acc, direction, key, currRequired);
  } else if (inPrev && !inCurr) {
    addDetail(
      acc,
      'breaking',
      `${capitalize(direction)} field "${key}" removed`
    );
  } else if (inPrev && inCurr) {
    diffModifiedField(
      acc,
      direction,
      key,
      prevProps,
      currProps,
      prevRequired,
      currRequired
    );
  }
};

const diffSchemaFields = (
  acc: DetailAccumulator,
  direction: 'input' | 'output',
  prev: JsonSchema | undefined,
  curr: JsonSchema | undefined
): void => {
  const prevProps = getProperties(prev);
  const currProps = getProperties(curr);
  const prevRequired = getRequired(prev);
  const currRequired = getRequired(curr);
  const allKeys = new Set([
    ...Object.keys(prevProps),
    ...Object.keys(currProps),
  ]);

  for (const key of [...allKeys].toSorted()) {
    diffKey(
      acc,
      direction,
      key,
      prevProps,
      currProps,
      prevRequired,
      currRequired
    );
  }
};

// ---------------------------------------------------------------------------
// Per-entry diffing
// ---------------------------------------------------------------------------

/** Diff surface additions and removals. */
const diffSurfaces = (
  acc: DetailAccumulator,
  prev: SurfaceMapEntry,
  curr: SurfaceMapEntry
): void => {
  const prevSurfaces = new Set(prev.surfaces);
  const currSurfaces = new Set(curr.surfaces);
  for (const s of [...currSurfaces].toSorted()) {
    if (!prevSurfaces.has(s)) {
      addDetail(acc, 'info', `Surface "${s}" added`);
    }
  }
  for (const s of [...prevSurfaces].toSorted()) {
    if (!currSurfaces.has(s)) {
      addDetail(acc, 'breaking', `Surface "${s}" removed`);
    }
  }
};

/** Diff safety markers, description, and deprecation. */
const diffMetadata = (
  acc: DetailAccumulator,
  prev: SurfaceMapEntry,
  curr: SurfaceMapEntry
): void => {
  if (prev.intent !== curr.intent) {
    addDetail(
      acc,
      'warning',
      `intent changed: ${String(prev.intent ?? 'write')} -> ${String(curr.intent ?? 'write')}`
    );
  }
  if (prev.idempotent !== curr.idempotent) {
    addDetail(
      acc,
      'warning',
      `idempotent changed: ${String(prev.idempotent ?? false)} -> ${String(curr.idempotent ?? false)}`
    );
  }
  if (prev.description !== curr.description) {
    addDetail(acc, 'info', 'Description updated');
  }
  if (!prev.deprecated && curr.deprecated) {
    const msg = curr.replacedBy
      ? `Deprecated (replaced by ${curr.replacedBy})`
      : 'Deprecated';
    addDetail(acc, 'warning', msg);
  } else if (prev.deprecated && !curr.deprecated) {
    addDetail(acc, 'info', 'Undeprecated');
  }
};

/** Build a follow-changed description from added/removed arrays. */
const buildFollowMessage = (added: string[], removed: string[]): string => {
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`added "${added.join('", "')}"`);
  }
  if (removed.length > 0) {
    parts.push(`removed "${removed.join('", "')}"`);
  }
  return `Follow changed: ${parts.join(', ')}`;
};

const buildServicesMessage = (added: string[], removed: string[]): string => {
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`added "${added.join('", "')}"`);
  }
  if (removed.length > 0) {
    parts.push(`removed "${removed.join('", "')}"`);
  }
  return `Services changed: ${parts.join(', ')}`;
};

/** Diff follow arrays. */
const diffFollow = (
  acc: DetailAccumulator,
  prev: SurfaceMapEntry,
  curr: SurfaceMapEntry
): void => {
  const prevFollow = new Set(prev.follow);
  const currFollow = new Set(curr.follow);
  const added = [...currFollow].filter((f) => !prevFollow.has(f)).toSorted();
  const removed = [...prevFollow].filter((f) => !currFollow.has(f)).toSorted();
  if (added.length > 0 || removed.length > 0) {
    addDetail(acc, 'warning', buildFollowMessage(added, removed));
  }
};

/** Diff declared service arrays on trail entries. */
const diffServices = (
  acc: DetailAccumulator,
  prev: SurfaceMapEntry,
  curr: SurfaceMapEntry
): void => {
  const prevServices = new Set(prev.services);
  const currServices = new Set(curr.services);
  const added = [...currServices]
    .filter((service) => !prevServices.has(service))
    .toSorted();
  const removed = [...prevServices]
    .filter((service) => !currServices.has(service))
    .toSorted();
  if (added.length > 0 || removed.length > 0) {
    addDetail(acc, 'warning', buildServicesMessage(added, removed));
  }
};

const diffEntry = (
  prev: SurfaceMapEntry,
  curr: SurfaceMapEntry
): DiffEntry | undefined => {
  const acc: DetailAccumulator = { details: [], severity: 'info' };

  diffSchemaFields(acc, 'input', prev.input, curr.input);
  diffSchemaFields(acc, 'output', prev.output, curr.output);
  diffSurfaces(acc, prev, curr);
  diffMetadata(acc, prev, curr);
  diffFollow(acc, prev, curr);
  diffServices(acc, prev, curr);

  if (acc.details.length === 0) {
    return undefined;
  }

  return {
    change: 'modified',
    details: acc.details,
    id: curr.id,
    kind: curr.kind,
    severity: acc.severity,
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a semantic diff between two surface maps.
 *
 * Classifies each change with a severity:
 * - `info`: new trail, optional field added, output field added, description change
 * - `warning`: safety marker change, deprecation, follow change
 * - `breaking`: trail removed, required input added, field removed, type change, surface removed
 */
/** Find entries added in curr that don't exist in prev. */
const findAdded = (
  prevById: Map<string, SurfaceMapEntry>,
  currById: Map<string, SurfaceMapEntry>
): DiffEntry[] =>
  [...currById.entries()]
    .filter(([id]) => !prevById.has(id))
    .map(([id, entry]) => ({
      change: 'added' as const,
      details: [`${labelForKind(entry.kind)} "${id}" added`],
      id,
      kind: entry.kind,
      severity: 'info' as const,
    }));

/** Find entries removed from prev that don't exist in curr. */
const findRemoved = (
  prevById: Map<string, SurfaceMapEntry>,
  currById: Map<string, SurfaceMapEntry>
): DiffEntry[] =>
  [...prevById.entries()]
    .filter(([id]) => !currById.has(id))
    .map(([id, entry]) => ({
      change: 'removed' as const,
      details: [`${labelForKind(entry.kind)} "${id}" removed`],
      id,
      kind: entry.kind,
      severity: 'breaking' as const,
    }));

/** Find entries modified between prev and curr. */
const findModified = (
  prevById: Map<string, SurfaceMapEntry>,
  currById: Map<string, SurfaceMapEntry>
): DiffEntry[] => {
  const results: DiffEntry[] = [];
  for (const [id, currEntry] of currById) {
    const prevEntry = prevById.get(id);
    if (prevEntry) {
      const diff = diffEntry(prevEntry, currEntry);
      if (diff) {
        results.push(diff);
      }
    }
  }
  return results;
};

/** Collect all diff entries (added, removed, modified) between two maps. */
const collectDiffEntries = (
  prevById: Map<string, SurfaceMapEntry>,
  currById: Map<string, SurfaceMapEntry>
): DiffEntry[] => [
  ...findAdded(prevById, currById),
  ...findRemoved(prevById, currById),
  ...findModified(prevById, currById),
];

export const diffSurfaceMaps = (
  prev: SurfaceMap,
  curr: SurfaceMap
): DiffResult => {
  const prevById = new Map(prev.entries.map((e) => [e.id, e]));
  const currById = new Map(curr.entries.map((e) => [e.id, e]));
  const sorted = collectDiffEntries(prevById, currById).toSorted((a, b) =>
    a.id.localeCompare(b.id)
  );

  const breaking = sorted.filter((e) => e.severity === 'breaking');
  const warnings = sorted.filter((e) => e.severity === 'warning');
  const info = sorted.filter((e) => e.severity === 'info');

  return {
    breaking,
    entries: sorted,
    hasBreaking: breaking.length > 0,
    info,
    warnings,
  };
};
