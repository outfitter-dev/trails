import { z } from 'zod';

/**
 * Runtime options for a contour declaration.
 */
export interface ContourOptions<
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
> {
  /** Field name that acts as the contour's primary identity. */
  readonly identity: TIdentity;
  /** Example instances validated against the contour schema at declaration time. */
  readonly examples?: readonly z.output<z.ZodObject<TShape>>[] | undefined;
}

/**
 * A first-class domain object with schema, identity metadata, and examples.
 *
 * A contour behaves like the `ZodObject` it wraps, so standard Zod composition
 * helpers such as `.pick()`, `.extend()`, and `.array()` continue to work.
 */
export type Contour<
  TShape extends z.ZodRawShape = z.ZodRawShape,
  TIdentity extends keyof TShape & string = keyof TShape & string,
> = z.ZodObject<TShape> & {
  readonly kind: 'contour';
  readonly name: string;
  readonly identity: TIdentity;
  readonly identitySchema: TShape[TIdentity];
  readonly examples?: readonly z.output<z.ZodObject<TShape>>[] | undefined;
};

const formatExampleIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

const assertIdentityField = <
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
>(
  name: string,
  shape: TShape,
  identity: TIdentity
): void => {
  if (!Object.hasOwn(shape, identity)) {
    throw new TypeError(
      `contour("${name}") identity "${identity}" must match a declared field`
    );
  }
};

const assertExamples = <TShape extends z.ZodRawShape>(
  name: string,
  schema: z.ZodObject<TShape>,
  examples: readonly z.output<z.ZodObject<TShape>>[]
): void => {
  for (const [index, example] of examples.entries()) {
    const parsed = schema.safeParse(example);
    if (!parsed.success) {
      throw new TypeError(
        `contour("${name}") example ${index} is invalid: ${formatExampleIssues(parsed.error.issues)}`
      );
    }
  }
};

/**
 * Create a contour definition from a raw Zod object shape.
 *
 * @example
 * ```typescript
 * const user = contour(
 *   'user',
 *   {
 *     id: z.string().uuid(),
 *     email: z.string().email(),
 *     name: z.string(),
 *   },
 *   { identity: 'id' }
 * );
 * ```
 */
export const contour = <
  TName extends string,
  TShape extends z.ZodRawShape,
  TIdentity extends keyof TShape & string,
>(
  name: TName,
  shape: TShape,
  options: ContourOptions<TShape, TIdentity>
): Contour<TShape, TIdentity> => {
  assertIdentityField(name, shape, options.identity);

  const schema = z.object(shape);
  if (options.examples) {
    assertExamples(name, schema, options.examples);
  }

  const examples = options.examples
    ? Object.freeze([...options.examples])
    : undefined;

  Object.defineProperties(schema, {
    examples: {
      enumerable: true,
      value: examples,
      writable: false,
    },
    identity: {
      enumerable: true,
      value: options.identity,
      writable: false,
    },
    identitySchema: {
      enumerable: true,
      value: shape[options.identity],
      writable: false,
    },
    kind: {
      enumerable: true,
      value: 'contour',
      writable: false,
    },
    name: {
      enumerable: true,
      value: name,
      writable: false,
    },
  });

  return schema as Contour<TShape, TIdentity>;
};

/** Existential type for heterogeneous contour collections. */
export type AnyContour = Contour<z.ZodRawShape, string>;
