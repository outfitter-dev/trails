import {
  ConflictError,
  InternalError,
  Result,
  ValidationError,
  contour,
  isTrailsError,
  trail,
} from '@ontrails/core';
import type {
  AnyContour,
  AnySignal,
  Resource,
  Trail,
  TrailContext,
  TrailExample,
} from '@ontrails/core';
import type { z } from 'zod';

import type {
  AnyStoreTable,
  EntityOf,
  StoreAccessor,
  UpsertOf,
} from '../types.js';

type ReconcileConnection<TTable extends AnyStoreTable> = Readonly<
  Record<TTable['name'], StoreAccessor<TTable>>
>;

export interface ReconcileConflict<TTable extends AnyStoreTable> {
  readonly current: EntityOf<TTable>;
  readonly incoming: UpsertOf<TTable>;
}

export type ReconcileStrategy<TTable extends AnyStoreTable> =
  | 'last-write-wins'
  | ((
      conflict: ReconcileConflict<TTable>,
      ctx: TrailContext
    ) => Promise<UpsertOf<TTable>> | UpsertOf<TTable>);

export interface ReconcileOptions<
  TTable extends AnyStoreTable,
  TConnection extends ReconcileConnection<TTable>,
> {
  readonly description?: string;
  readonly id?: string;
  readonly on?: readonly (AnySignal | string)[];
  readonly resource: Resource<TConnection>;
  readonly strategy?: ReconcileStrategy<TTable>;
  readonly table: TTable;
}

const contourCache = new WeakMap<AnyStoreTable, AnyContour>();
const versionFieldName = 'version';

const createTableContour = <TTable extends AnyStoreTable>(
  table: TTable
): AnyContour => {
  const cached = contourCache.get(table);
  if (cached) {
    return cached;
  }

  const clonedShape = Object.fromEntries(
    Object.entries(table.schema.shape).map(([field, schema]) => [
      field,
      schema.clone(),
    ])
  );
  const derived = contour(
    table.name,
    clonedShape as Record<string, z.ZodType>,
    {
      examples: table.fixtures as readonly Record<string, unknown>[],
      identity: table.identity,
    }
  ) as AnyContour;

  contourCache.set(table, derived);
  return derived;
};

const resolveAccessor = <
  TTable extends AnyStoreTable,
  TConnection extends ReconcileConnection<TTable>,
>(
  table: TTable,
  resource: Resource<TConnection>,
  ctx: TrailContext
): StoreAccessor<TTable> => {
  const connection = resource.from(ctx);
  return connection[table.name as keyof TConnection] as StoreAccessor<TTable>;
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const mapReconcileError = (trailId: string, error: unknown): Error => {
  if (isTrailsError(error)) {
    return error;
  }

  const resolved = asError(error);
  return new InternalError(`${trailId} failed: ${resolved.message}`, {
    cause: resolved,
  });
};

const omitUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, candidate]) => candidate !== undefined)
  ) as T;

const currentVersion = <TTable extends AnyStoreTable>(
  current: EntityOf<TTable>
): number => current[versionFieldName as keyof EntityOf<TTable>] as number;

const lastWriteWins = <TTable extends AnyStoreTable>(
  conflict: ReconcileConflict<TTable>
): UpsertOf<TTable> =>
  ({
    ...conflict.current,
    ...omitUndefined(conflict.incoming as Record<string, unknown>),
    [versionFieldName]: currentVersion(conflict.current),
  }) as UpsertOf<TTable>;

const normalizeResolvedInput = <TTable extends AnyStoreTable>(
  table: TTable,
  current: EntityOf<TTable>,
  resolved: UpsertOf<TTable>
): UpsertOf<TTable> =>
  ({
    ...current,
    ...omitUndefined(resolved as Record<string, unknown>),
    [table.identity]: current[
      table.identity as keyof EntityOf<TTable>
    ] as EntityOf<TTable>[keyof EntityOf<TTable>],
    [versionFieldName]: currentVersion(current),
  }) as UpsertOf<TTable>;

const deriveExamples = <TTable extends AnyStoreTable>(
  table: TTable
): readonly TrailExample<UpsertOf<TTable>, EntityOf<TTable>>[] | undefined => {
  const examples = table.fixtures.flatMap((fixture) => {
    const parsed = table.schema.safeParse(fixture);
    if (!parsed.success) {
      return [];
    }

    return [
      {
        expected: parsed.data as EntityOf<TTable>,
        input: fixture as UpsertOf<TTable>,
        name: `Reconcile ${table.name} ${String(
          fixture[table.identity as keyof typeof fixture]
        )}`,
      },
    ];
  });

  return examples.length === 0 ? undefined : Object.freeze(examples);
};

const buildConflict = async <TTable extends AnyStoreTable>(
  table: TTable,
  input: UpsertOf<TTable>,
  accessor: StoreAccessor<TTable>,
  error: ConflictError
): Promise<ConflictError | ReconcileConflict<TTable>> => {
  const identifier = input[table.identity as keyof typeof input] as
    | EntityOf<TTable>[keyof EntityOf<TTable>]
    | undefined;

  if (identifier === undefined) {
    return error;
  }

  const current = await accessor.get(identifier as never);
  return current === null ? error : { current, incoming: input };
};

const resolveStrategy = async <TTable extends AnyStoreTable>(
  strategy: ReconcileStrategy<TTable>,
  conflict: ReconcileConflict<TTable>,
  ctx: TrailContext
): Promise<UpsertOf<TTable>> =>
  strategy === 'last-write-wins'
    ? lastWriteWins(conflict)
    : await strategy(conflict, ctx);

const recoverConflict = async <TTable extends AnyStoreTable>(
  table: TTable,
  input: UpsertOf<TTable>,
  accessor: StoreAccessor<TTable>,
  error: ConflictError,
  strategy: ReconcileStrategy<TTable>,
  ctx: TrailContext
) => {
  const conflict = await buildConflict(table, input, accessor, error);
  if (conflict instanceof ConflictError) {
    return Result.err(conflict);
  }

  const resolved = await resolveStrategy(strategy, conflict, ctx);
  const normalized = normalizeResolvedInput(table, conflict.current, resolved);
  return Result.ok(await accessor.upsert(normalized));
};

const createReconcileBlaze =
  <
    TTable extends AnyStoreTable,
    TConnection extends ReconcileConnection<TTable>,
  >(
    options: ReconcileOptions<TTable, TConnection>,
    id: string,
    strategy: ReconcileStrategy<TTable>
  ) =>
  async (input: UpsertOf<TTable>, ctx: TrailContext) => {
    const accessor = resolveAccessor(options.table, options.resource, ctx);

    try {
      return Result.ok(await accessor.upsert(input));
    } catch (error) {
      if (!(error instanceof ConflictError)) {
        return Result.err(mapReconcileError(id, error));
      }

      try {
        return await recoverConflict(
          options.table,
          input,
          accessor,
          error,
          strategy,
          ctx
        );
      } catch (conflictError) {
        return Result.err(mapReconcileError(id, conflictError));
      }
    }
  };

/**
 * Produce one trail that retries a versioned upsert with a conflict strategy
 * when the incoming entity is stale.
 */
export const reconcile = <
  TTable extends AnyStoreTable,
  TConnection extends ReconcileConnection<TTable>,
>(
  options: ReconcileOptions<TTable, TConnection>
): Trail<UpsertOf<TTable>, EntityOf<TTable>> => {
  if (!options.table.versioned) {
    throw new ValidationError(
      `reconcile("${options.table.name}") requires a versioned store table.`
    );
  }

  const id = options.id ?? `${options.table.name}.reconcile`;
  const entityContour = createTableContour(options.table);
  const strategy = options.strategy ?? 'last-write-wins';

  return trail<UpsertOf<TTable>, EntityOf<TTable>>(id, {
    blaze: createReconcileBlaze(options, id, strategy),
    contours: [entityContour],
    description:
      options.description ??
      `Reconcile version conflicts for "${options.table.name}" entities.`,
    examples: deriveExamples(options.table),
    input: options.table.fixtureSchema as unknown as z.ZodType<
      UpsertOf<TTable>
    >,
    intent: 'write',
    on: options.on,
    output: options.table.schema as unknown as z.ZodType<EntityOf<TTable>>,
    resources: [options.resource],
  });
};
