import type { z } from 'zod';

import type { ActivationSource } from './activation-source.js';
import type { AnySignal } from './signal.js';
import { zodToJsonSchema } from './validation.js';

export interface ActivationSchemaIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

type SourcePayloadContract =
  | {
      readonly schema: z.ZodType<unknown>;
      readonly type: 'schema';
    }
  | {
      readonly type: 'value';
      readonly value: unknown;
    };

type JsonSchemaObject = Record<string, unknown>;

const hasOwn = (value: object, key: string): boolean =>
  Object.hasOwn(value, key);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isZodSchema = (value: unknown): value is z.ZodType<unknown> =>
  isObjectRecord(value) &&
  typeof value['safeParse'] === 'function' &&
  isObjectRecord(value['_zod']);

const normalizeIssuePath = (
  path: readonly unknown[]
): readonly (string | number)[] =>
  Object.freeze(
    path.map((segment) =>
      typeof segment === 'string' || typeof segment === 'number'
        ? segment
        : String(segment)
    )
  );

const getActivationPayloadContract = (
  source: ActivationSource,
  signals: ReadonlyMap<string, AnySignal>
): SourcePayloadContract | undefined => {
  if (source.kind === 'signal') {
    const signal = signals.get(source.id);
    return signal ? { schema: signal.payload, type: 'schema' } : undefined;
  }

  if (isZodSchema(source.payload)) {
    return { schema: source.payload, type: 'schema' };
  }

  if (isZodSchema(source.parse)) {
    return { schema: source.parse, type: 'schema' };
  }

  if (isObjectRecord(source.parse) && isZodSchema(source.parse['output'])) {
    return { schema: source.parse['output'], type: 'schema' };
  }

  if (isZodSchema(source.input)) {
    return { schema: source.input, type: 'schema' };
  }

  if (hasOwn(source, 'input')) {
    return { type: 'value', value: source.input };
  }

  return undefined;
};

const zodIssuesToCompatibilityIssues = (
  issues: readonly z.ZodIssue[]
): readonly ActivationSchemaIssue[] =>
  Object.freeze(
    issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: normalizeIssuePath(issue.path),
    }))
  );

const jsonSchemaFor = (schema: z.ZodType<unknown>): JsonSchemaObject =>
  zodToJsonSchema(schema) as JsonSchemaObject;

const jsonObjectAt = (
  schema: JsonSchemaObject,
  key: string
): JsonSchemaObject | undefined => {
  const value = schema[key];
  return isObjectRecord(value) ? value : undefined;
};

const jsonObjectEntriesAt = (
  schema: JsonSchemaObject,
  key: string
): readonly [string, JsonSchemaObject][] => {
  const value = schema[key];
  if (!isObjectRecord(value)) {
    return [];
  }
  return Object.entries(value).filter(
    (entry): entry is [string, JsonSchemaObject] => isObjectRecord(entry[1])
  );
};

const jsonSchemaArrayAt = (
  schema: JsonSchemaObject,
  key: string
): readonly JsonSchemaObject[] => {
  const value = schema[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isObjectRecord);
};

const stringArrayAt = (
  schema: JsonSchemaObject,
  key: string
): readonly string[] => {
  const value = schema[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
};

const primitiveTypeOf = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
};

const schemaTypes = (
  schema: JsonSchemaObject
): ReadonlySet<string> | undefined => {
  const { type } = schema;
  if (typeof type === 'string') {
    return new Set([type]);
  }
  if (Array.isArray(type)) {
    const types = type.filter(
      (entry): entry is string => typeof entry === 'string'
    );
    return types.length > 0 ? new Set(types) : undefined;
  }
  if (hasOwn(schema, 'const')) {
    return new Set([primitiveTypeOf(schema['const'])]);
  }
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return new Set(enumValues.map(primitiveTypeOf));
  }

  const anyOf = jsonSchemaArrayAt(schema, 'anyOf');
  if (anyOf.length > 0) {
    const allTypes = new Set<string>();
    for (const option of anyOf) {
      const optionTypes = schemaTypes(option);
      if (!optionTypes) {
        return undefined;
      }
      for (const optionType of optionTypes) {
        allTypes.add(optionType);
      }
    }
    return allTypes;
  }

  return undefined;
};

const setsIntersect = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean => {
  for (const entry of left) {
    if (right.has(entry)) {
      return true;
    }
  }
  return false;
};

const describeSchemaTypes = (types: ReadonlySet<string> | undefined): string =>
  types ? [...types].toSorted().join(' | ') : 'unknown';

const valueSet = (
  schema: JsonSchemaObject
): ReadonlySet<unknown> | undefined => {
  if (hasOwn(schema, 'const')) {
    return new Set([schema['const']]);
  }
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues)) {
    return new Set(enumValues);
  }

  const anyOf = jsonSchemaArrayAt(schema, 'anyOf');
  if (anyOf.length === 0) {
    return undefined;
  }

  const values = new Set<unknown>();
  for (const option of anyOf) {
    const optionValues = valueSet(option);
    if (optionValues === undefined) {
      return undefined;
    }
    for (const value of optionValues) {
      values.add(value);
    }
  }
  return values;
};

const allValuesIn = (
  source: ReadonlySet<unknown>,
  target: ReadonlySet<unknown>
): boolean => {
  for (const value of source) {
    if (!target.has(value)) {
      return false;
    }
  }
  return true;
};

const compatibilityIssue = (
  code: string,
  path: readonly (string | number)[],
  message: string
): ActivationSchemaIssue => ({
  code,
  message,
  path: Object.freeze([...path]),
});

const sourceGuaranteesObjectProperty = (
  key: string,
  required: ReadonlySet<string>,
  properties: ReadonlyMap<string, JsonSchemaObject>
): boolean => {
  const property = properties.get(key);
  return (
    property !== undefined && (required.has(key) || hasOwn(property, 'default'))
  );
};

const checkEnumCompatibility = (
  source: JsonSchemaObject,
  target: JsonSchemaObject,
  path: readonly (string | number)[]
): readonly ActivationSchemaIssue[] => {
  if (!hasOwn(target, 'const') && !Array.isArray(target['enum'])) {
    return [];
  }

  const targetValues = valueSet(target);
  const sourceValues = valueSet(source);
  if (targetValues && sourceValues && allValuesIn(sourceValues, targetValues)) {
    return [];
  }

  return [
    compatibilityIssue(
      hasOwn(target, 'const') ? 'const' : 'enum',
      path,
      'Source schema can produce values outside the accepted input values'
    ),
  ];
};

const checkTypeCompatibility = (
  source: JsonSchemaObject,
  target: JsonSchemaObject,
  path: readonly (string | number)[]
): readonly ActivationSchemaIssue[] => {
  const targetTypes = schemaTypes(target);
  if (!targetTypes) {
    return [];
  }

  const sourceTypes = schemaTypes(source);
  if (sourceTypes && setsIntersect(sourceTypes, targetTypes)) {
    return [];
  }

  return [
    compatibilityIssue(
      'type',
      path,
      `Source schema type ${describeSchemaTypes(sourceTypes)} is not compatible with input schema type ${describeSchemaTypes(targetTypes)}`
    ),
  ];
};

const checkSchemaCompatibility = (
  source: JsonSchemaObject,
  target: JsonSchemaObject,
  path: readonly (string | number)[] = Object.freeze([])
): readonly ActivationSchemaIssue[] => {
  if (Object.keys(target).length === 0) {
    return [];
  }

  const sourceOptions = jsonSchemaArrayAt(source, 'anyOf');
  if (sourceOptions.length > 0) {
    return sourceOptions.flatMap((option) =>
      checkSchemaCompatibility(option, target, path)
    );
  }

  const targetOptions = jsonSchemaArrayAt(target, 'anyOf');
  if (targetOptions.length > 0) {
    const optionIssues = targetOptions.map((option) =>
      checkSchemaCompatibility(source, option, path)
    );
    return optionIssues.some((issues) => issues.length === 0)
      ? []
      : (optionIssues[0] ?? []);
  }

  const issues = [
    ...checkEnumCompatibility(source, target, path),
    ...checkTypeCompatibility(source, target, path),
  ];
  if (issues.length > 0) {
    return issues;
  }

  const objectIssues = (() => {
    if (target['type'] !== 'object') {
      return [];
    }

    const sourceRequired = new Set(stringArrayAt(source, 'required'));
    const sourceProperties = new Map(jsonObjectEntriesAt(source, 'properties'));
    const targetProperties = new Map(jsonObjectEntriesAt(target, 'properties'));
    const nestedIssues: ActivationSchemaIssue[] = [];

    for (const requiredKey of stringArrayAt(target, 'required')) {
      if (
        !sourceGuaranteesObjectProperty(
          requiredKey,
          sourceRequired,
          sourceProperties
        )
      ) {
        nestedIssues.push(
          compatibilityIssue(
            'required',
            [...path, requiredKey],
            `Source schema does not guarantee required input field "${requiredKey}"`
          )
        );
      }
    }

    for (const [key, targetProperty] of targetProperties) {
      const sourceProperty = sourceProperties.get(key);
      if (!sourceProperty) {
        continue;
      }
      nestedIssues.push(
        ...checkSchemaCompatibility(sourceProperty, targetProperty, [
          ...path,
          key,
        ])
      );
    }

    return nestedIssues;
  })();
  if (objectIssues.length > 0) {
    return objectIssues;
  }

  if (target['type'] !== 'array') {
    return [];
  }

  const sourceItems = jsonObjectAt(source, 'items');
  const targetItems = jsonObjectAt(target, 'items');
  if (!sourceItems || !targetItems) {
    return [];
  }

  return checkSchemaCompatibility(sourceItems, targetItems, [...path, '*']);
};

export const getActivationSourceInputCompatibilityIssues = (
  inputSchema: z.ZodType<unknown>,
  source: ActivationSource,
  signals: ReadonlyMap<string, AnySignal>
): readonly ActivationSchemaIssue[] | undefined => {
  const contract = getActivationPayloadContract(source, signals);
  if (!contract) {
    return undefined;
  }

  if (contract.type === 'value') {
    const parsed = inputSchema.safeParse(contract.value);
    return parsed.success
      ? []
      : zodIssuesToCompatibilityIssues(parsed.error.issues);
  }

  return checkSchemaCompatibility(
    jsonSchemaFor(contract.schema),
    jsonSchemaFor(inputSchema)
  );
};
