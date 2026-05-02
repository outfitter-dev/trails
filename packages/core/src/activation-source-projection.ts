import type { ActivationSource } from './activation-source.js';
import { zodToJsonSchema } from './validation.js';

type ZodSchemaInput = Parameters<typeof zodToJsonSchema>[0];

export type ActivationSourceProjection = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly key: string;
  readonly kind: string;
};

export const activationSourceKey = (
  source: Pick<ActivationSource, 'id' | 'kind'>
): string => `${source.kind}:${source.id}`;

const sortKeys = <T extends Record<string, unknown>>(value: T): T => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    sorted[key] = value[key];
  }
  return sorted as T;
};

const deepSortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(deepSortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = deepSortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

const canonicalLeaf = (value: unknown): unknown => {
  switch (typeof value) {
    case 'bigint': {
      return value.toString();
    }
    case 'function': {
      return `[Function:${value.name || 'anonymous'}]`;
    }
    case 'symbol': {
      return `[Symbol:${value.description ?? ''}]`;
    }
    case 'undefined': {
      return '[Undefined]';
    }
    default: {
      return value;
    }
  }
};

const canonicalObject = (
  value: Record<string, unknown>,
  visit: (value: unknown) => unknown
): Record<string, unknown> => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    const next = value[key];
    sorted[key] = next === undefined ? '[Undefined]' : visit(next);
  }
  return sorted;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (value !== null && typeof value === 'object') {
    return canonicalObject(value as Record<string, unknown>, canonicalize);
  }
  return canonicalLeaf(value);
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isZodSchema = (value: unknown): value is ZodSchemaInput =>
  isObjectRecord(value) &&
  typeof value['safeParse'] === 'function' &&
  isObjectRecord(value['_zod']);

const toSortedJsonSchema = (
  schema: ZodSchemaInput
): Readonly<Record<string, unknown>> =>
  deepSortKeys(zodToJsonSchema(schema)) as Readonly<Record<string, unknown>>;

const parseOutputSchema = (
  source: ActivationSource
): ZodSchemaInput | undefined => {
  if (isZodSchema(source.parse)) {
    return source.parse;
  }
  if (isObjectRecord(source.parse) && isZodSchema(source.parse['output'])) {
    return source.parse['output'];
  }
  return undefined;
};

export const projectActivationSourceDeclaration = (
  source: ActivationSource
): ActivationSourceProjection => {
  const record: Record<string, unknown> = {
    id: source.id,
    key: activationSourceKey(source),
    kind: source.kind,
  };

  if (source.cron !== undefined) {
    record['cron'] = source.cron;
  }
  if (Object.hasOwn(source, 'input')) {
    if (isZodSchema(source.input)) {
      record['inputSchema'] = toSortedJsonSchema(source.input);
    } else {
      record['input'] = canonicalize(source.input);
    }
  }
  if (source.meta !== undefined) {
    record['meta'] = canonicalize(source.meta);
  }
  if (source.parse !== undefined) {
    record['hasParse'] = true;
    const output = parseOutputSchema(source);
    if (output !== undefined) {
      record['parseOutputSchema'] = toSortedJsonSchema(output);
    }
  }
  if (source.payload !== undefined) {
    record['hasPayloadSchema'] = true;
    if (isZodSchema(source.payload)) {
      record['payloadSchema'] = toSortedJsonSchema(source.payload);
    }
  }
  if (source.timezone !== undefined) {
    record['timezone'] = source.timezone;
  }

  return sortKeys(record) as ActivationSourceProjection;
};

export const activationSourceDeclarationSignature = (
  source: ActivationSource
): string => JSON.stringify(projectActivationSourceDeclaration(source));
