import { ConflictError, Result, ValidationError, trail } from '@ontrails/core';
import type {
  AnySignal,
  Detour,
  Resource,
  Trail,
  TrailContext,
  TrailExample,
  TrailsError,
} from '@ontrails/core';
import { z } from 'zod';

import type {
  AnyStoreTable,
  EntityOf,
  StoreAccessor,
  UpsertOf,
} from '../types.js';
import { versionFieldName } from '../store.js';
import { createTableContour, mapStoreTrailError } from './utils.js';

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

/** Resolve a version conflict through the configured strategy and retry the upsert. */
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

/**
 * Build the input schema for a reconcile trail.
 *
 * `fixtureSchema` makes generated fields (including `version` on versioned
 * tables) optional because connectors populate them. Reconcile, however,
 * relies on optimistic concurrency: the caller must pass the expected
 * `version` so `assertExpectedVersionMatch` can detect stale payloads. We
 * therefore extend `fixtureSchema` with a required `version` field so
 * callers cannot sidestep optimistic concurrency at the input boundary.
 */
const buildReconcileInputSchema = <TTable extends AnyStoreTable>(
  table: TTable
): z.ZodType<UpsertOf<TTable>> =>
  table.fixtureSchema.extend({
    [versionFieldName]: z.number().int(),
  }) as unknown as z.ZodType<UpsertOf<TTable>>;

/** The blaze performs only the initial upsert; conflict recovery is handled by the detour. */
const createReconcileBlaze =
  <
    TTable extends AnyStoreTable,
    TConnection extends ReconcileConnection<TTable>,
  >(
    options: ReconcileOptions<TTable, TConnection>,
    id: string
  ) =>
  async (input: UpsertOf<TTable>, ctx: TrailContext) => {
    try {
      const accessor = resolveAccessor(options.table, options.resource, ctx);
      return Result.ok(await accessor.upsert(input));
    } catch (error) {
      if (error instanceof ConflictError) {
        return Result.err(error);
      }
      return Result.err(mapStoreTrailError(id, error));
    }
  };

/** Build the detour that handles ConflictError recovery via the configured strategy. */
const createReconcileDetour = <
  TTable extends AnyStoreTable,
  TConnection extends ReconcileConnection<TTable>,
>(
  options: ReconcileOptions<TTable, TConnection>,
  id: string,
  strategy: ReconcileStrategy<TTable>
): Detour<UpsertOf<TTable>, EntityOf<TTable>, TrailsError> => ({
  maxAttempts: 1,
  on: ConflictError,
  recover: async (attempt, ctx) => {
    const conflictError = attempt.error as ConflictError;
    try {
      const accessor = resolveAccessor(options.table, options.resource, ctx);
      return await recoverConflict(
        options.table,
        attempt.input,
        accessor,
        conflictError,
        strategy,
        ctx
      );
    } catch (error) {
      if (error instanceof ConflictError) {
        return Result.err(error);
      }
      return Result.err(mapStoreTrailError(id, error) as TrailsError);
    }
  },
});

/**
 * Produce one trail that retries a versioned upsert with a conflict strategy
 * when the incoming entity is stale.
 *
 * Reconcile is bounded to a single retry via a declarative `detour`. If a
 * concurrent writer races the retry and produces a second `ConflictError`,
 * the detour loop wraps it in `RetryExhaustedError<ConflictError>` so
 * callers can distinguish "retry reconcile at a higher level" from
 * "reconcile tried and lost the race".
 *
 * @remarks
 * For versioned tables, the derived input schema requires an explicit
 * `version` field so callers cannot sidestep optimistic concurrency at the
 * input boundary. `fixtureSchema` alone makes `version` optional because
 * connectors populate it for writes; reconcile must reject that relaxed
 * shape.
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
    blaze: createReconcileBlaze(options, id),
    contours: [entityContour],
    description:
      options.description ??
      `Reconcile version conflicts for "${options.table.name}" entities.`,
    detours: [createReconcileDetour(options, id, strategy)],
    examples: deriveExamples(options.table),
    input: buildReconcileInputSchema(options.table),
    intent: 'write',
    on: options.on,
    output: options.table.schema as unknown as z.ZodType<EntityOf<TTable>>,
    resources: [options.resource],
  });
};
