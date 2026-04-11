import { ConflictError, Result, ValidationError, trail } from '@ontrails/core';
import type {
  AnySignal,
  Resource,
  Trail,
  TrailContext,
  TrailExample,
} from '@ontrails/core';
import { z } from 'zod';

import type {
  AnyStoreTable,
  EntityOf,
  StoreAccessor,
  UpsertOf,
} from '../types.js';
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

/**
 * Surfaced when `reconcile` exhausts its single retry after a second
 * `ConflictError` from the underlying store. Extends `ConflictError` so
 * callers that catch `ConflictError` still catch it, while still allowing
 * "I should retry reconcile at a higher level" to be distinguished from
 * "reconcile tried and lost the race".
 */
export class ReconcileRetryExhaustedError extends ConflictError {}

const versionFieldName = 'version';

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

/**
 * Single-retry conflict recovery.
 *
 * `recoverConflict` retries `upsert` exactly once after resolving the
 * conflict through the configured strategy. A concurrent writer between
 * retries produces a second `ConflictError`, which is wrapped in a
 * `ReconcileRetryExhaustedError` by the blaze so callers can distinguish
 * "I should retry reconcile at a higher level" from "reconcile tried and
 * lost the race".
 */
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

const wrapRetryExhaustion = (
  trailId: string,
  error: unknown
): ReconcileRetryExhaustedError | Error => {
  if (!(error instanceof ConflictError)) {
    return mapStoreTrailError(trailId, error);
  }

  if (error instanceof ReconcileRetryExhaustedError) {
    return error;
  }

  return new ReconcileRetryExhaustedError(
    `${trailId} retry exhausted after second conflict: ${error.message}`,
    { cause: error }
  );
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

/**
 * Conflict recovery uses inline try/catch rather than `detours` because
 * detours are declarative-only today — there is no execution machinery to
 * wire recovery strategies to versioned upserts yet. Factory-provided trails
 * like `reconcile` need working recovery at runtime, so the inline path is
 * the pragmatic bridge until a detour execution primitive lands. See the
 * "Factory-provided trails" carve-out in the repo-root `AGENTS.md`.
 */
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
    try {
      const accessor = resolveAccessor(options.table, options.resource, ctx);

      try {
        return Result.ok(await accessor.upsert(input));
      } catch (error) {
        if (!(error instanceof ConflictError)) {
          return Result.err(mapStoreTrailError(id, error));
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
          return Result.err(wrapRetryExhaustion(id, conflictError));
        }
      }
    } catch (error) {
      return Result.err(mapStoreTrailError(id, error));
    }
  };

/**
 * Produce one trail that retries a versioned upsert with a conflict strategy
 * when the incoming entity is stale.
 *
 * Reconcile is bounded to a single retry. If a concurrent writer races the
 * retry and produces a second `ConflictError`, the blaze surfaces a
 * `ReconcileRetryExhaustedError` (a `ConflictError` subclass) so callers can
 * distinguish "retry reconcile at a higher level" from "reconcile tried and
 * lost the race".
 *
 * Conflict recovery is inline rather than delegated to a `detour` because
 * detours are declarative-only today — there is no execution machinery for
 * them yet. Factory-provided trails need working recovery at runtime, so
 * the inline path is the pragmatic bridge until a detour execution primitive
 * lands. See the "Factory-provided trails" carve-out in the repo-root
 * `AGENTS.md`.
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
    blaze: createReconcileBlaze(options, id, strategy),
    contours: [entityContour],
    description:
      options.description ??
      `Reconcile version conflicts for "${options.table.name}" entities.`,
    examples: deriveExamples(options.table),
    input: buildReconcileInputSchema(options.table),
    intent: 'write',
    on: options.on,
    output: options.table.schema as unknown as z.ZodType<EntityOf<TTable>>,
    resources: [options.resource],
  });
};
