interface QueryZodInternals {
  readonly _zod: {
    readonly def: Readonly<Record<string, unknown>>;
  };
}

interface QueryLayerFieldMetadata {
  readonly knownFields: ReadonlySet<string>;
  readonly preserveRawFields: ReadonlySet<string>;
}

interface QueryLayerRendering {
  readonly routing: ReadonlyMap<string, string>;
}

const queryLayerFieldMetadata = new WeakMap<
  ReadonlyMap<string, string>,
  QueryLayerFieldMetadata
>();

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const queryZodDef = (
  schema: unknown
): Readonly<Record<string, unknown>> | undefined => {
  if (!isRecord(schema)) {
    return undefined;
  }
  const internals = (schema as Partial<QueryZodInternals>)._zod;
  return internals !== undefined && isRecord(internals.def)
    ? internals.def
    : undefined;
};

const querySchemaContainsCoercion = (
  schema: unknown,
  seen = new Set<unknown>()
): boolean => {
  const def = queryZodDef(schema);
  if (def === undefined) {
    return false;
  }
  if (def['coerce'] === true) {
    return true;
  }
  if (seen.has(schema)) {
    return false;
  }
  seen.add(schema);

  const { element, innerType, options, type } = def;
  if (type === 'array') {
    return querySchemaContainsCoercion(element, seen);
  }
  if (type === 'union') {
    return (
      Array.isArray(options) &&
      options.some((option) => querySchemaContainsCoercion(option, seen))
    );
  }
  if (
    type === 'default' ||
    type === 'nullable' ||
    type === 'optional' ||
    type === 'readonly'
  ) {
    return querySchemaContainsCoercion(innerType, seen);
  }
  return false;
};

export const coercingQueryFields = (schema: unknown): ReadonlySet<string> => {
  const fields = new Set<string>();
  const visit = (candidate: unknown, seen: Set<unknown>): void => {
    const def = queryZodDef(candidate);
    if (def === undefined || seen.has(candidate)) {
      return;
    }
    seen.add(candidate);

    const { innerType, options, shape, type } = def;
    if (type === 'object') {
      if (!isRecord(shape)) {
        return;
      }
      for (const [name, fieldSchema] of Object.entries(shape)) {
        if (querySchemaContainsCoercion(fieldSchema)) {
          fields.add(name);
        }
      }
      return;
    }
    if (type === 'union') {
      if (!Array.isArray(options)) {
        return;
      }
      for (const option of options) {
        visit(option, seen);
      }
      return;
    }
    if (
      type === 'default' ||
      type === 'nullable' ||
      type === 'optional' ||
      type === 'readonly'
    ) {
      visit(innerType, seen);
    }
  };
  visit(schema, new Set());
  return fields;
};

export const recordQueryLayerCoercion = (
  inputSchema: unknown,
  routing: ReadonlyMap<string, string>
): void => {
  const coercingFields = coercingQueryFields(inputSchema);
  const preserveRawFields = new Set<string>();
  for (const [renderedName, originalName] of routing) {
    if (coercingFields.has(originalName)) {
      preserveRawFields.add(renderedName);
    }
  }
  queryLayerFieldMetadata.set(routing, {
    knownFields: new Set(routing.keys()),
    preserveRawFields,
  });
};

export const preservedLayerQueryFields = (
  renderings: readonly QueryLayerRendering[]
): ReadonlySet<string> => {
  const preserveRawFields = new Set<string>();
  for (const { routing } of renderings) {
    const metadata = queryLayerFieldMetadata.get(routing);
    for (const renderedName of routing.keys()) {
      if (
        metadata === undefined ||
        !metadata.knownFields.has(renderedName) ||
        metadata.preserveRawFields.has(renderedName)
      ) {
        preserveRawFields.add(renderedName);
      }
    }
  }
  return preserveRawFields;
};
