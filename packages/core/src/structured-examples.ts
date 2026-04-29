import type { TrailExample } from './trail.js';

export interface StructuredTrailExampleProvenance {
  readonly source: 'trail.examples';
}

export interface StructuredSignalExampleProvenance {
  readonly source: 'signal.examples';
}

export type StructuredTrailExampleKind = 'success' | 'error';

export interface StructuredTrailExample {
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly expected?: unknown | undefined;
  readonly expectedMatch?: unknown | undefined;
  readonly input: unknown;
  readonly kind: StructuredTrailExampleKind;
  readonly name: string;
  readonly provenance: StructuredTrailExampleProvenance;
}

export interface StructuredSignalExample {
  readonly kind: 'payload';
  readonly payload: unknown;
  readonly provenance: StructuredSignalExampleProvenance;
}

// `Date`, `RegExp`, `Map`, and `Set` are objects (`typeof === 'object'`),
// so they would pass the structural walk and reach `JSON.stringify`, which
// silently coerces them: a `Date` becomes its ISO string, a `RegExp` and
// any `Map`/`Set` become `{}`. Either way the projected shape diverges
// from the example author's declared input. Treat them as non-serializable
// leaves so the example is dropped rather than misrepresented to MCP
// clients.
const isNonJsonLeaf = (value: unknown): boolean => {
  const kind = typeof value;
  if (kind === 'function' || kind === 'symbol' || kind === 'bigint') {
    return true;
  }
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set
  );
};

// `JSON.stringify` silently drops function / symbol property values rather than
// throwing, so we walk the value first and reject any example whose graph
// contains a non-serializable leaf. Without this, an MCP client consuming
// `ontrails/examples` would receive structurally incorrect inputs.
const containsNonSerializableLeaf = (
  value: unknown,
  seen: WeakSet<object>
): boolean => {
  if (isNonJsonLeaf(value)) {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    return false;
  }
  seen.add(obj);
  if (Array.isArray(value)) {
    return value.some((entry) => containsNonSerializableLeaf(entry, seen));
  }
  return Object.values(obj).some((entry) =>
    containsNonSerializableLeaf(entry, seen)
  );
};

const toJsonSerializable = (value: unknown): unknown | undefined => {
  if (containsNonSerializableLeaf(value, new WeakSet<object>())) {
    return undefined;
  }
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? undefined : JSON.parse(encoded);
  } catch {
    return undefined;
  }
};

const projectExample = (
  example: TrailExample<unknown, unknown>
): StructuredTrailExample | undefined => {
  const input = toJsonSerializable(example.input);
  if (input === undefined) {
    return undefined;
  }

  const projected: Record<string, unknown> = {
    input,
    kind: example.error === undefined ? 'success' : 'error',
    name: example.name,
    provenance: { source: 'trail.examples' },
  };

  if (example.description !== undefined) {
    projected['description'] = example.description;
  }
  if (example.expected !== undefined) {
    const expected = toJsonSerializable(example.expected);
    if (expected === undefined) {
      return undefined;
    }
    projected['expected'] = expected;
  }
  if (example.expectedMatch !== undefined) {
    const expectedMatch = toJsonSerializable(example.expectedMatch);
    if (expectedMatch === undefined) {
      return undefined;
    }
    projected['expectedMatch'] = expectedMatch;
  }
  if (example.error !== undefined) {
    projected['error'] = example.error;
  }

  return Object.freeze(projected) as unknown as StructuredTrailExample;
};

const projectSignalExample = (
  payload: unknown
): StructuredSignalExample | undefined => {
  const serializablePayload = toJsonSerializable(payload);
  if (serializablePayload === undefined) {
    return undefined;
  }

  return Object.freeze({
    kind: 'payload',
    payload: serializablePayload,
    provenance: { source: 'signal.examples' },
  } satisfies StructuredSignalExample);
};

export const deriveStructuredTrailExamples = (
  examples: readonly TrailExample<unknown, unknown>[] | undefined
): readonly StructuredTrailExample[] | undefined => {
  if (examples === undefined || examples.length === 0) {
    return undefined;
  }

  const projected = examples
    .map(projectExample)
    .filter(
      (example): example is StructuredTrailExample => example !== undefined
    );

  return projected.length > 0 ? Object.freeze(projected) : undefined;
};

export const deriveStructuredSignalExamples = (
  examples: readonly unknown[] | undefined
): readonly StructuredSignalExample[] | undefined => {
  if (examples === undefined || examples.length === 0) {
    return undefined;
  }

  const projected = examples
    .map(projectSignalExample)
    .filter(
      (example): example is StructuredSignalExample => example !== undefined
    );

  return projected.length > 0 ? Object.freeze(projected) : undefined;
};
