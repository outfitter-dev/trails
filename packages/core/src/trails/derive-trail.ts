import { z } from 'zod';

import type { AnyContour } from '../contour.js';
import type { AnyResource } from '../resource.js';
import { trail } from '../trail.js';
import type { Trail, TrailExample, TrailSpec } from '../trail.js';

/**
 * CRUD-shaped operations the base trail derivation helper understands.
 */
export type DeriveTrailOperation =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'list';

type ContourInput<TContour extends AnyContour> = z.input<TContour>;
type ContourOutput<TContour extends AnyContour> = z.output<TContour>;
type ContourFieldKey<TContour extends AnyContour> = Extract<
  keyof ContourOutput<TContour>,
  string
>;
type IdentityKey<TContour extends AnyContour> = Extract<
  TContour['identity'],
  keyof ContourInput<TContour> & string
>;

type GeneratedKey<
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
> = TGenerated extends readonly ContourFieldKey<TContour>[]
  ? TGenerated[number]
  : never;

type CreateInputOf<
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
> = Omit<
  ContourInput<TContour>,
  Extract<GeneratedKey<TContour, TGenerated>, keyof ContourInput<TContour>>
>;

type ReadInputOf<TContour extends AnyContour> = Pick<
  ContourInput<TContour>,
  IdentityKey<TContour>
>;

type UpdateInputOf<
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
> = ReadInputOf<TContour> &
  Partial<Omit<CreateInputOf<TContour, TGenerated>, IdentityKey<TContour>>>;

type ListInputOf<TContour extends AnyContour> = Partial<ContourInput<TContour>>;

/**
 * Input shape derived for one operation against one contour.
 */
export type DeriveTrailInput<
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined =
    | readonly ContourFieldKey<TContour>[]
    | undefined,
> = TOperation extends 'create'
  ? CreateInputOf<TContour, TGenerated>
  : TOperation extends 'read' | 'delete'
    ? ReadInputOf<TContour>
    : TOperation extends 'update'
      ? UpdateInputOf<TContour, TGenerated>
      : ListInputOf<TContour>;

/**
 * Output shape derived for one operation against one contour.
 */
export type DeriveTrailOutput<
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
> = TOperation extends 'delete'
  ? undefined
  : TOperation extends 'list'
    ? ContourOutput<TContour>[]
    : ContourOutput<TContour>;

/**
 * Extra authored data accepted by `deriveTrail()` in addition to the
 * operation-derived contract pieces.
 */
export interface DeriveTrailSpec<
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined =
    | readonly ContourFieldKey<TContour>[]
    | undefined,
> extends Omit<
  TrailSpec<
    DeriveTrailInput<TContour, TOperation, TGenerated>,
    DeriveTrailOutput<TContour, TOperation>
  >,
  'contours' | 'examples' | 'input' | 'intent' | 'output' | 'resources'
> {
  /**
   * Server-managed fields that should not be writable through derived create
   * and update inputs.
   */
  readonly generated?: TGenerated;
  /**
   * Resource dependency declared on the derived trail.
   */
  readonly resource: AnyResource | readonly AnyResource[];
}

const operationIntent = {
  create: 'write',
  delete: 'destroy',
  list: 'read',
  read: 'read',
  update: 'write',
} as const;

const titleCase = (value: string): string =>
  value.length === 0 ? value : value.slice(0, 1).toUpperCase() + value.slice(1);

const uniqueStrings = (
  values: readonly string[] | undefined
): readonly string[] =>
  Object.freeze([...(values === undefined ? [] : new Set(values))]);

const buildFieldMask = (fields: readonly string[]): Record<string, true> =>
  Object.fromEntries(fields.map((field) => [field, true] as const)) as Record<
    string,
    true
  >;

type AnyObjectSchema = z.ZodObject<Record<string, z.ZodType>>;

const asObjectSchema = (schema: z.ZodType): AnyObjectSchema =>
  schema as unknown as AnyObjectSchema;

const unsupportedOperation = (operation: never): never => {
  throw new TypeError(
    `Unsupported deriveTrail() operation: ${String(operation)}`
  );
};

const omitFields = (
  schema: z.ZodType,
  fields: readonly string[]
): AnyObjectSchema => {
  const objectSchema = asObjectSchema(schema);

  return fields.length === 0
    ? objectSchema
    : (objectSchema.omit(buildFieldMask(fields)) as unknown as AnyObjectSchema);
};

const pickFields = (
  schema: z.ZodType,
  fields: readonly string[]
): AnyObjectSchema =>
  asObjectSchema(schema).pick(
    buildFieldMask(fields)
  ) as unknown as AnyObjectSchema;

/**
 * Strip default wrappers before `.partial()` so filter/update schemas do not
 * silently re-materialize defaults during validation.
 */
const isWrapperType = (
  type: string
): type is 'default' | 'nullable' | 'optional' =>
  type === 'default' || type === 'nullable' || type === 'optional';

const readInnerType = (schema: z.ZodType): z.ZodType =>
  (schema.def as unknown as { innerType: z.ZodType }).innerType;

const applyWrapper = (
  schema: z.ZodType,
  wrapper: 'nullable' | 'optional'
): z.ZodType =>
  wrapper === 'nullable' ? schema.nullable() : schema.optional();

const collectWrappers = (
  schema: z.ZodType
): {
  readonly current: z.ZodType;
  readonly wrappers: readonly ('nullable' | 'optional')[];
} => {
  const wrappers: ('nullable' | 'optional')[] = [];
  let current = schema;

  while (isWrapperType(current.def.type)) {
    const { type } = current.def;
    if (type !== 'default') {
      wrappers.push(type);
    }

    current = readInnerType(current);
  }

  return { current, wrappers };
};

const applyWrappers = (
  schema: z.ZodType,
  wrappers: readonly ('nullable' | 'optional')[]
): z.ZodType => {
  let rebuilt = schema;

  for (const wrapper of wrappers) {
    rebuilt = applyWrapper(rebuilt, wrapper);
  }

  return rebuilt;
};

const stripDefaultWrappers = (schema: z.ZodType): z.ZodType => {
  const { current, wrappers } = collectWrappers(schema);
  return applyWrappers(current, wrappers);
};

const stripDefaultsFromShape = (
  schema: z.ZodType
): Record<string, z.ZodType> => {
  const stripped: Record<string, z.ZodType> = {};
  const objectSchema = asObjectSchema(schema);

  for (const [field, value] of Object.entries(objectSchema.shape)) {
    stripped[field] = stripDefaultWrappers(value);
  }

  return stripped;
};

const toPartialSchema = (schema: z.ZodType): AnyObjectSchema =>
  asObjectSchema(schema)
    .extend(stripDefaultsFromShape(schema))
    .partial() as unknown as AnyObjectSchema;

const normalizeResources = (
  resource: AnyResource | readonly AnyResource[]
): readonly AnyResource[] =>
  Object.freeze(Array.isArray(resource) ? [...resource] : [resource]);

const identityInputSchema = <TContour extends AnyContour>(
  contour: TContour
): z.ZodType<ReadInputOf<TContour>> =>
  pickFields(contour, [contour.identity]) as unknown as z.ZodType<
    ReadInputOf<TContour>
  >;

const createInputSchema = <
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
>(
  contour: TContour,
  generated: readonly string[]
): z.ZodType<CreateInputOf<TContour, TGenerated>> =>
  omitFields(contour, generated) as unknown as z.ZodType<
    CreateInputOf<TContour, TGenerated>
  >;

const updateInputSchema = <
  TContour extends AnyContour,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
>(
  contour: TContour,
  generated: readonly string[]
): z.ZodType<UpdateInputOf<TContour, TGenerated>> => {
  const mutableSchema = omitFields(contour, [...generated, contour.identity]);
  const identitySchema = asObjectSchema(identityInputSchema(contour));

  return identitySchema.extend(
    toPartialSchema(mutableSchema).shape
  ) as unknown as z.ZodType<UpdateInputOf<TContour, TGenerated>>;
};

const listInputSchema = <TContour extends AnyContour>(
  contour: TContour
): z.ZodType<ListInputOf<TContour>> =>
  toPartialSchema(contour) as unknown as z.ZodType<ListInputOf<TContour>>;

const deriveInputSchema = <
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined,
>(
  contour: TContour,
  operation: TOperation,
  generated: readonly string[]
): z.ZodType<DeriveTrailInput<TContour, TOperation, TGenerated>> => {
  switch (operation) {
    case 'create': {
      return createInputSchema<TContour, TGenerated>(
        contour,
        generated
      ) as z.ZodType<DeriveTrailInput<TContour, TOperation, TGenerated>>;
    }
    case 'read':
    case 'delete': {
      return identityInputSchema(contour) as z.ZodType<
        DeriveTrailInput<TContour, TOperation, TGenerated>
      >;
    }
    case 'update': {
      return updateInputSchema<TContour, TGenerated>(
        contour,
        generated
      ) as z.ZodType<DeriveTrailInput<TContour, TOperation, TGenerated>>;
    }
    case 'list': {
      return listInputSchema(contour) as z.ZodType<
        DeriveTrailInput<TContour, TOperation, TGenerated>
      >;
    }
    default: {
      return unsupportedOperation(operation);
    }
  }
};

const deriveOutputSchema = <
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
>(
  contour: TContour,
  operation: TOperation
): z.ZodType<DeriveTrailOutput<TContour, TOperation>> => {
  switch (operation) {
    case 'delete': {
      return z.void() as unknown as z.ZodType<
        DeriveTrailOutput<TContour, TOperation>
      >;
    }
    case 'list': {
      return contour.array() as unknown as z.ZodType<
        DeriveTrailOutput<TContour, TOperation>
      >;
    }
    case 'create':
    case 'read':
    case 'update': {
      return contour as unknown as z.ZodType<
        DeriveTrailOutput<TContour, TOperation>
      >;
    }
    default: {
      return unsupportedOperation(operation);
    }
  }
};

type ExampleRecord = Readonly<Record<string, unknown>>;

const pickValueFields = (
  example: ExampleRecord,
  fields: readonly string[]
): Record<string, unknown> =>
  Object.fromEntries(
    fields.flatMap((field) =>
      Object.hasOwn(example, field) ? [[field, example[field]]] : []
    )
  );

const omitValueFields = (
  example: ExampleRecord,
  fields: readonly string[]
): Record<string, unknown> => {
  const omitted = new Set(fields);

  return Object.fromEntries(
    Object.entries(example).filter(([field]) => !omitted.has(field))
  );
};

const formatExampleName = (
  contour: AnyContour,
  operation: DeriveTrailOperation,
  example: ExampleRecord,
  index: number
): string => {
  const identifier = example[contour.identity];
  const suffix =
    identifier === undefined ? String(index + 1) : String(identifier);
  return `${titleCase(operation)} ${contour.name} ${suffix}`;
};

const deriveExample = (
  contour: AnyContour,
  operation: DeriveTrailOperation,
  example: ExampleRecord,
  index: number,
  generated: readonly string[]
): TrailExample<unknown, unknown> => {
  const name = formatExampleName(contour, operation, example, index);
  const identity = pickValueFields(example, [contour.identity]);

  switch (operation) {
    case 'create': {
      return {
        expected: example,
        input: omitValueFields(example, generated),
        name,
      };
    }
    case 'read': {
      return {
        expected: example,
        input: identity,
        name,
      };
    }
    case 'update': {
      return {
        expected: example,
        input: {
          ...omitValueFields(example, [...generated, contour.identity]),
          ...identity,
        },
        name,
      };
    }
    case 'delete': {
      return {
        input: identity,
        name,
      };
    }
    case 'list': {
      return {
        expected: [example],
        input: identity,
        name,
      };
    }
    default: {
      return unsupportedOperation(operation);
    }
  }
};

const deriveExamples = (
  contour: AnyContour,
  operation: DeriveTrailOperation,
  generated: readonly string[]
): readonly TrailExample<unknown, unknown>[] | undefined => {
  if (contour.examples === undefined || contour.examples.length === 0) {
    return undefined;
  }

  return Object.freeze(
    contour.examples.map((example, index) =>
      deriveExample(
        contour,
        operation,
        example as ExampleRecord,
        index,
        generated
      )
    )
  );
};

/**
 * Mechanically project one CRUD-shaped trail from a contour declaration.
 */
export const deriveTrail = <
  TContour extends AnyContour,
  TOperation extends DeriveTrailOperation,
  TGenerated extends readonly ContourFieldKey<TContour>[] | undefined =
    | readonly ContourFieldKey<TContour>[]
    | undefined,
>(
  contour: TContour,
  operation: TOperation,
  spec: DeriveTrailSpec<TContour, TOperation, TGenerated>
): Trail<
  DeriveTrailInput<TContour, TOperation, TGenerated>,
  DeriveTrailOutput<TContour, TOperation>
> => {
  if (typeof spec.blaze !== 'function') {
    throw new TypeError(
      `deriveTrail("${contour.name}.${operation}") requires a blaze implementation`
    );
  }

  const generated = uniqueStrings(
    spec.generated as readonly string[] | undefined
  );
  const resources = normalizeResources(spec.resource);
  const { resource: _resource, generated: _generated, ...trailSpec } = spec;
  const derivedSpec = {
    ...trailSpec,
    contours: [contour],
    examples: deriveExamples(contour, operation, generated),
    input: deriveInputSchema<TContour, TOperation, TGenerated>(
      contour,
      operation,
      generated
    ),
    intent: operationIntent[operation],
    output: deriveOutputSchema(contour, operation),
    resources,
  } as unknown as TrailSpec<
    DeriveTrailInput<TContour, TOperation, TGenerated>,
    DeriveTrailOutput<TContour, TOperation>
  >;

  return trail(`${contour.name}.${operation}`, derivedSpec) as unknown as Trail<
    DeriveTrailInput<TContour, TOperation, TGenerated>,
    DeriveTrailOutput<TContour, TOperation>
  >;
};
