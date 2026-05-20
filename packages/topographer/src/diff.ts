/**
 * Semantic diffing of topo graphs.
 */

import type {
  DiffEntry,
  DiffResult,
  JsonSchema,
  TopoGraph,
  TopoGraphEntry,
  TopoGraphForceEntry,
  TopoGraphVersionEntry,
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

const labelForKind = (kind: TopoGraphEntry['kind']): string => {
  if (kind === 'contour') {
    return 'Contour';
  }
  if (kind === 'resource') {
    return 'Resource';
  }
  if (kind === 'signal') {
    return 'Signal';
  }
  return 'Trail';
};

const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, nested) => {
    if (Array.isArray(nested)) {
      return [...nested].toSorted((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b))
      );
    }
    if (
      nested !== null &&
      typeof nested === 'object' &&
      !Array.isArray(nested)
    ) {
      return Object.fromEntries(Object.entries(nested).toSorted());
    }
    return nested;
  });

const permitScopes = (
  permit: TopoGraphEntry['permit'] | undefined
): ReadonlySet<string> | undefined =>
  permit === undefined || permit === 'public'
    ? undefined
    : new Set(permit.scopes);

const permitChangeSeverity = (
  prevPermit: TopoGraphEntry['permit'] | undefined,
  currPermit: TopoGraphEntry['permit'] | undefined
): Severity => {
  const prevScopes = permitScopes(prevPermit);
  const currScopes = permitScopes(currPermit);
  if (currScopes === undefined) {
    return 'warning';
  }
  if (prevScopes === undefined) {
    return 'breaking';
  }
  for (const scope of currScopes) {
    if (!prevScopes.has(scope)) {
      return 'breaking';
    }
  }
  return 'warning';
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

const getAddedFieldLabel = (
  direction: 'contour' | 'input' | 'output'
): string => {
  if (direction === 'output') {
    return 'Output';
  }
  if (direction === 'contour') {
    return 'Optional contour';
  }
  return 'Optional input';
};

/** Diff a single field that was added. */
const diffAddedField = (
  acc: DetailAccumulator,
  direction: 'contour' | 'input' | 'output',
  key: string,
  currRequired: ReadonlySet<string>
): void => {
  if (
    (direction === 'contour' || direction === 'input') &&
    currRequired.has(key)
  ) {
    addDetail(acc, 'breaking', `Required ${direction} field "${key}" added`);
  } else {
    const label = getAddedFieldLabel(direction);
    addDetail(acc, 'info', `${label} field "${key}" added`);
  }
};

/** Diff a single field present in both prev and curr. */
const diffModifiedField = (
  acc: DetailAccumulator,
  direction: 'contour' | 'input' | 'output',
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
    (direction === 'contour' || direction === 'input') &&
    !prevRequired.has(key) &&
    currRequired.has(key)
  ) {
    addDetail(
      acc,
      'breaking',
      `${capitalize(direction)} field "${key}" changed from optional to required`
    );
  }
};

/** Diff a single key across prev/curr schemas. */
const diffKey = (
  acc: DetailAccumulator,
  direction: 'contour' | 'input' | 'output',
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
  direction: 'contour' | 'input' | 'output',
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
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  const prevSurfaces = new Set(prev.surfaces);
  const currSurfaces = new Set(curr.surfaces);
  for (const surface of [...currSurfaces].toSorted()) {
    if (!prevSurfaces.has(surface)) {
      addDetail(acc, 'info', `Surface "${surface}" added`);
    }
  }
  for (const surface of [...prevSurfaces].toSorted()) {
    if (!currSurfaces.has(surface)) {
      addDetail(acc, 'breaking', `Surface "${surface}" removed`);
    }
  }
};

/** Diff safety markers, description, and deprecation. */
const diffMetadata = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
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
  if (prev.dryRunCapable !== curr.dryRunCapable) {
    addDetail(
      acc,
      'warning',
      `dryRunCapable changed: ${String(prev.dryRunCapable ?? false)} -> ${String(curr.dryRunCapable ?? false)}`
    );
  }
  const prevPermit = stableStringify(prev.permit ?? 'undeclared');
  const currPermit = stableStringify(curr.permit ?? 'undeclared');
  if (prevPermit !== currPermit) {
    addDetail(
      acc,
      permitChangeSeverity(prev.permit, curr.permit),
      `permit changed: ${prevPermit} -> ${currPermit}`
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

const diffCliPath = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  const prevPath = prev.cli?.path.join(' ');
  const currPath = curr.cli?.path.join(' ');

  if (prevPath === currPath) {
    return;
  }

  // First-time CLI path recording (upgrade from a lockfile without paths)
  // is informational, not a breaking change.
  if (prevPath === undefined && currPath !== undefined) {
    addDetail(acc, 'info', `CLI path recorded: ${currPath}`);
    return;
  }

  addDetail(
    acc,
    'breaking',
    `CLI path changed: ${prevPath ?? '(none)'} -> ${currPath ?? '(none)'}`
  );
};

/** Build a crossing-changed description from added/removed arrays. */
const buildCrossesMessage = (added: string[], removed: string[]): string => {
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`added "${added.join('", "')}"`);
  }
  if (removed.length > 0) {
    parts.push(`removed "${removed.join('", "')}"`);
  }
  return `Crosses changed: ${parts.join(', ')}`;
};

const buildResourcesMessage = (added: string[], removed: string[]): string => {
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`added "${added.join('", "')}"`);
  }
  if (removed.length > 0) {
    parts.push(`removed "${removed.join('", "')}"`);
  }
  return `Resources changed: ${parts.join(', ')}`;
};

const buildContoursMessage = (added: string[], removed: string[]): string => {
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`added "${added.join('", "')}"`);
  }
  if (removed.length > 0) {
    parts.push(`removed "${removed.join('", "')}"`);
  }
  return `Contours changed: ${parts.join(', ')}`;
};

/** Diff crosses arrays. */
const diffCrosses = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  const prevCrosses = new Set(prev.crosses);
  const currCrosses = new Set(curr.crosses);
  const added = [...currCrosses]
    .filter((crossedId) => !prevCrosses.has(crossedId))
    .toSorted();
  const removed = [...prevCrosses]
    .filter((crossedId) => !currCrosses.has(crossedId))
    .toSorted();
  if (added.length > 0 || removed.length > 0) {
    addDetail(acc, 'warning', buildCrossesMessage(added, removed));
  }
};

/** Diff declared resource arrays on trail entries. */
const diffResources = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  const prevResources = new Set(prev.resources);
  const currResources = new Set(curr.resources);
  const added = [...currResources]
    .filter((resource) => !prevResources.has(resource))
    .toSorted();
  const removed = [...prevResources]
    .filter((resource) => !currResources.has(resource))
    .toSorted();
  if (added.length > 0 || removed.length > 0) {
    addDetail(acc, 'warning', buildResourcesMessage(added, removed));
  }
};

const isLiveVersionEntry = (entry: TopoGraphVersionEntry): boolean =>
  entry.status?.state !== 'archived';

const statusLabel = (
  status: TopoGraphVersionEntry['status'] | undefined
): string => status?.state ?? 'live';

const diffNumberSet = (
  acc: DetailAccumulator,
  label: string,
  previous: readonly number[] | undefined,
  current: readonly number[] | undefined,
  removedSeverity: Severity
): void => {
  const prevValues = new Set(previous);
  const currValues = new Set(current);
  const added = [...currValues]
    .filter((value) => !prevValues.has(value))
    .toSorted((left, right) => left - right);
  const removed = [...prevValues]
    .filter((value) => !currValues.has(value))
    .toSorted((left, right) => left - right);

  if (added.length > 0) {
    addDetail(acc, 'info', `${label} added: ${added.join(', ')}`);
  }
  if (removed.length > 0) {
    addDetail(acc, removedSeverity, `${label} removed: ${removed.join(', ')}`);
  }
};

const diffVersionSchemaFields = (
  acc: DetailAccumulator,
  version: string,
  prev: TopoGraphVersionEntry,
  curr: TopoGraphVersionEntry
): void => {
  const versionAcc: DetailAccumulator = { details: [], severity: 'info' };
  diffSchemaFields(versionAcc, 'input', prev.input, curr.input);
  diffSchemaFields(versionAcc, 'output', prev.output, curr.output);

  for (const detail of versionAcc.details) {
    addDetail(acc, versionAcc.severity, `Version ${version} ${detail}`);
  }
};

const diffVersionEntry = (
  acc: DetailAccumulator,
  version: string,
  prev: TopoGraphVersionEntry,
  curr: TopoGraphVersionEntry
): void => {
  if (prev.kind !== curr.kind) {
    addDetail(
      acc,
      'breaking',
      `Version ${version} kind changed: ${prev.kind} -> ${curr.kind}`
    );
  }

  const prevStatus = statusLabel(prev.status);
  const currStatus = statusLabel(curr.status);
  if (prevStatus !== currStatus) {
    addDetail(
      acc,
      currStatus === 'archived' ? 'warning' : 'info',
      `Version ${version} status changed: ${prevStatus} -> ${currStatus}`
    );
  }

  if (prev.marker !== curr.marker) {
    addDetail(
      acc,
      'info',
      `Version ${version} marker changed: ${prev.marker} -> ${curr.marker}`
    );
  }

  diffVersionSchemaFields(acc, version, prev, curr);
};

const diffVersionEntries = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  diffNumberSet(
    acc,
    'Supported versions',
    prev.supports,
    curr.supports,
    'breaking'
  );

  if (prev.version !== curr.version) {
    addDetail(
      acc,
      'info',
      `Current version changed: ${String(prev.version ?? '(none)')} -> ${String(curr.version ?? '(none)')}`
    );
  }

  if (prev.marker !== curr.marker) {
    addDetail(
      acc,
      'info',
      `Current marker changed: ${String(prev.marker ?? '(none)')} -> ${String(curr.marker ?? '(none)')}`
    );
  }

  const prevVersions = prev.versions ?? {};
  const currVersions = curr.versions ?? {};
  const versions = new Set([
    ...Object.keys(prevVersions),
    ...Object.keys(currVersions),
  ]);

  for (const version of [...versions].toSorted(
    (left, right) => Number(left) - Number(right)
  )) {
    const previous = prevVersions[version];
    const current = currVersions[version];
    if (previous === undefined && current !== undefined) {
      addDetail(
        acc,
        isLiveVersionEntry(current) ? 'warning' : 'info',
        `Version ${version} added (${statusLabel(current.status)})`
      );
      continue;
    }
    if (previous !== undefined && current === undefined) {
      addDetail(
        acc,
        isLiveVersionEntry(previous) ? 'breaking' : 'warning',
        `Version ${version} removed (${statusLabel(previous.status)})`
      );
      continue;
    }
    if (previous !== undefined && current !== undefined) {
      diffVersionEntry(acc, version, previous, current);
    }
  }
};

const diffVersionExampleCoverage = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  const previousVersions = prev.versions ?? {};
  for (const [version, entry] of Object.entries(curr.versions ?? {}).toSorted(
    ([left], [right]) => Number(left) - Number(right)
  )) {
    if (!isLiveVersionEntry(entry)) {
      continue;
    }

    const previous = previousVersions[version];
    if (entry.exampleCount === 0 && previous === undefined) {
      addDetail(
        acc,
        'warning',
        `Live version ${version} added without examples`
      );
      continue;
    }

    if (
      previous !== undefined &&
      isLiveVersionEntry(previous) &&
      previous.exampleCount > 0 &&
      entry.exampleCount === 0
    ) {
      addDetail(
        acc,
        'warning',
        `Live version ${version} example coverage removed`
      );
      continue;
    }

    if (previous?.exampleCount !== entry.exampleCount) {
      addDetail(
        acc,
        'info',
        `Live version ${version} examples: ${previous?.exampleCount ?? 0} -> ${entry.exampleCount}`
      );
    }
  }
};

const forceKey = (force: TopoGraphForceEntry): string =>
  stableStringify({
    change: force.change,
    detail: force.detail,
    id: force.id,
    kind: force.kind,
    reason: force.reason,
    severity: force.severity,
    source: force.source,
  });

const diffForces = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  const prevForces = new Map(
    (prev.forces ?? []).map((force) => [forceKey(force), force])
  );
  const currForces = new Map(
    (curr.forces ?? []).map((force) => [forceKey(force), force])
  );

  for (const [key, force] of [...currForces].toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!prevForces.has(key)) {
      addDetail(
        acc,
        'warning',
        `Force event recorded: ${force.change} ${force.detail}`
      );
    }
  }

  for (const [key, force] of [...prevForces].toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!currForces.has(key)) {
      addDetail(
        acc,
        'warning',
        `Force event removed: ${force.change} ${force.detail}`
      );
    }
  }
};

const forceDiffEntry = (
  force: TopoGraphForceEntry,
  direction: 'recorded' | 'removed'
): DiffEntry => ({
  change: 'modified',
  details: [`Force event ${direction}: ${force.change} ${force.detail}`],
  id: force.id,
  kind: force.kind,
  severity: 'warning',
});

const diffGraphForces = (prev: TopoGraph, curr: TopoGraph): DiffEntry[] => {
  const prevForces = new Map(
    (prev.forces ?? []).map((force) => [forceKey(force), force])
  );
  const currForces = new Map(
    (curr.forces ?? []).map((force) => [forceKey(force), force])
  );
  const entries: DiffEntry[] = [];

  for (const [key, force] of [...currForces].toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!prevForces.has(key)) {
      entries.push(forceDiffEntry(force, 'recorded'));
    }
  }

  for (const [key, force] of [...prevForces].toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!currForces.has(key)) {
      entries.push(forceDiffEntry(force, 'removed'));
    }
  }

  return entries;
};

/** Diff declared contour arrays on trail entries. */
const diffContours = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  const prevContours = new Set(prev.contours);
  const currContours = new Set(curr.contours);
  const added = [...currContours]
    .filter((contour) => !prevContours.has(contour))
    .toSorted();
  const removed = [...prevContours]
    .filter((contour) => !currContours.has(contour))
    .toSorted();
  if (added.length > 0 || removed.length > 0) {
    addDetail(acc, 'warning', buildContoursMessage(added, removed));
  }
};

const diffContourSchema = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  diffSchemaFields(acc, 'contour', prev.schema, curr.schema);

  if (prev.identity !== curr.identity) {
    addDetail(
      acc,
      'breaking',
      `Contour identity changed: ${String(prev.identity ?? '(none)')} -> ${String(curr.identity ?? '(none)')}`
    );
  }
};

const referenceLabel = (reference: {
  readonly contour: string;
  readonly field: string;
  readonly identity: string;
}): string => `${reference.field}:${reference.contour}.${reference.identity}`;

const diffContourReferences = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  const prevReferences = new Set(
    (prev.references ?? []).map((reference) => referenceLabel(reference))
  );
  const currReferences = new Set(
    (curr.references ?? []).map((reference) => referenceLabel(reference))
  );
  const added = [...currReferences]
    .filter((reference) => !prevReferences.has(reference))
    .toSorted();
  const removed = [...prevReferences]
    .filter((reference) => !currReferences.has(reference))
    .toSorted();

  if (added.length > 0) {
    addDetail(
      acc,
      'warning',
      `Contour references added: "${added.join('", "')}"`
    );
  }

  if (removed.length > 0) {
    addDetail(
      acc,
      'breaking',
      `Contour references removed: "${removed.join('", "')}"`
    );
  }
};

const diffTrailEntryDetails = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  diffSchemaFields(acc, 'input', prev.input, curr.input);
  diffSchemaFields(acc, 'output', prev.output, curr.output);
  diffCliPath(acc, prev, curr);
  diffCrosses(acc, prev, curr);
  diffContours(acc, prev, curr);
  diffResources(acc, prev, curr);
  diffVersionEntries(acc, prev, curr);
  diffVersionExampleCoverage(acc, prev, curr);
  diffForces(acc, prev, curr);
};

const diffEntryDetails = (
  acc: DetailAccumulator,
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): void => {
  diffSurfaces(acc, prev, curr);
  diffMetadata(acc, prev, curr);

  if (curr.kind === 'contour') {
    diffContourSchema(acc, prev, curr);
    diffContourReferences(acc, prev, curr);
    return;
  }

  diffTrailEntryDetails(acc, prev, curr);
};

const diffEntry = (
  prev: TopoGraphEntry,
  curr: TopoGraphEntry
): DiffEntry | undefined => {
  const acc: DetailAccumulator = { details: [], severity: 'info' };

  diffEntryDetails(acc, prev, curr);

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
 * Compute a semantic diff between two topo graphs.
 *
 * Classifies each change with a severity:
 * - `info`: new trail, optional field added, output field added, description change
 * - `warning`: safety marker change, deprecation, crossing change
 * - `breaking`: trail removed, required input added, field removed, type change, surface removed
 */
/** Find entries added in curr that don't exist in prev. */
const findAdded = (
  prevById: Map<string, TopoGraphEntry>,
  currById: Map<string, TopoGraphEntry>
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
  prevById: Map<string, TopoGraphEntry>,
  currById: Map<string, TopoGraphEntry>
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
  prevById: Map<string, TopoGraphEntry>,
  currById: Map<string, TopoGraphEntry>
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
  prev: TopoGraph,
  curr: TopoGraph,
  prevById: Map<string, TopoGraphEntry>,
  currById: Map<string, TopoGraphEntry>
): DiffEntry[] => [
  ...findAdded(prevById, currById),
  ...findRemoved(prevById, currById),
  ...findModified(prevById, currById),
  ...diffGraphForces(prev, curr),
];

export const deriveTopoGraphDiff = (
  prev: TopoGraph,
  curr: TopoGraph
): DiffResult => {
  const prevById = new Map(prev.entries.map((e) => [e.id, e]));
  const currById = new Map(curr.entries.map((e) => [e.id, e]));
  const sorted = collectDiffEntries(prev, curr, prevById, currById).toSorted(
    (a, b) => a.id.localeCompare(b.id)
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
