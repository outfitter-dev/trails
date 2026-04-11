import { InternalError, NotFoundError, Result, trail } from '@ontrails/core';
import type {
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
  ReadOnlyStoreTableAccessor,
  StoreAccessor,
  StoreIdentifierOf,
  UpsertOf,
} from '../types.js';
import { createTableContour, mapStoreTrailError } from './utils.js';

type IdentityInputOf<TTable extends AnyStoreTable> = Readonly<
  Record<Extract<TTable['identity'], string>, StoreIdentifierOf<TTable>>
>;

type SourceConnection<TTable extends AnyStoreTable> = Readonly<
  Record<TTable['name'], ReadOnlyStoreTableAccessor<TTable>>
>;

type TargetConnection<TTable extends AnyStoreTable> = Readonly<
  Record<TTable['name'], StoreAccessor<TTable>>
>;

export interface SyncEndpoint<
  TTable extends AnyStoreTable,
  TConnection extends SourceConnection<TTable> | TargetConnection<TTable>,
> {
  readonly resource: Resource<TConnection>;
  readonly table: TTable;
}

export type SyncTransform<
  TSourceTable extends AnyStoreTable,
  TTargetTable extends AnyStoreTable,
> = (
  entity: EntityOf<TSourceTable>,
  ctx: TrailContext
) => Promise<UpsertOf<TTargetTable>> | UpsertOf<TTargetTable>;

export interface SyncOptions<
  TSourceTable extends AnyStoreTable,
  TTargetTable extends AnyStoreTable,
  TSourceConnection extends SourceConnection<TSourceTable>,
  TTargetConnection extends TargetConnection<TTargetTable>,
> {
  readonly description?: string;
  readonly from: SyncEndpoint<TSourceTable, TSourceConnection>;
  readonly id?: string;
  readonly on?: readonly (AnySignal | string)[];
  readonly to: SyncEndpoint<TTargetTable, TTargetConnection>;
  readonly transform?: SyncTransform<TSourceTable, TTargetTable>;
}

const resolveSourceAccessor = <
  TTable extends AnyStoreTable,
  TConnection extends SourceConnection<TTable>,
>(
  endpoint: SyncEndpoint<TTable, TConnection>,
  ctx: TrailContext
): ReadOnlyStoreTableAccessor<TTable> => {
  const connection = endpoint.resource.from(ctx);
  return connection[
    endpoint.table.name as keyof TConnection
  ] as ReadOnlyStoreTableAccessor<TTable>;
};

const resolveTargetAccessor = <
  TTable extends AnyStoreTable,
  TConnection extends TargetConnection<TTable>,
>(
  endpoint: SyncEndpoint<TTable, TConnection>,
  ctx: TrailContext
): StoreAccessor<TTable> => {
  const connection = endpoint.resource.from(ctx);
  return connection[
    endpoint.table.name as keyof TConnection
  ] as StoreAccessor<TTable>;
};

const sourceMissingError = <TTable extends AnyStoreTable>(
  table: TTable,
  id: StoreIdentifierOf<TTable>
): NotFoundError =>
  new NotFoundError(
    `Store table "${table.name}" could not find source entity "${String(id)}"`
  );

const identityInputSchema = <TTable extends AnyStoreTable>(
  table: TTable
): z.ZodType<IdentityInputOf<TTable>> =>
  table.schema.pick({
    [table.identity]: true,
  } as never) as unknown as z.ZodType<IdentityInputOf<TTable>>;

const deriveExamples = <
  TSourceTable extends AnyStoreTable,
  TTargetTable extends AnyStoreTable,
>(
  sourceTable: TSourceTable,
  targetTable: TTargetTable,
  transform: SyncTransform<TSourceTable, TTargetTable> | undefined
):
  | readonly TrailExample<
      IdentityInputOf<TSourceTable>,
      EntityOf<TTargetTable>
    >[]
  | undefined => {
  const targetById = new Map<
    StoreIdentifierOf<TTargetTable>,
    EntityOf<TTargetTable>
  >();
  for (const fixture of targetTable.fixtures) {
    const id = fixture[targetTable.identity as keyof typeof fixture] as
      | StoreIdentifierOf<TTargetTable>
      | undefined;
    if (id !== undefined) {
      targetById.set(id, fixture as EntityOf<TTargetTable>);
    }
  }

  const examples = sourceTable.fixtures.flatMap((fixture) => {
    const id = fixture[sourceTable.identity as keyof typeof fixture] as
      | StoreIdentifierOf<TSourceTable>
      | undefined;
    if (id === undefined) {
      return [];
    }

    const targetFixture =
      targetById.get(id as unknown as StoreIdentifierOf<TTargetTable>) ??
      (transform === undefined && targetTable.schema.safeParse(fixture).success
        ? (fixture as EntityOf<TTargetTable>)
        : undefined);

    if (targetFixture === undefined) {
      return [];
    }

    return [
      {
        expected: targetFixture,
        input: { [sourceTable.identity]: id } as IdentityInputOf<TSourceTable>,
        name: `Sync ${targetTable.name} ${String(id)}`,
      },
    ];
  });

  return examples.length === 0 ? undefined : Object.freeze(examples);
};

/**
 * Produce one trail that reads one source entity and writes the transformed
 * result into a target store resource.
 */
export const sync = <
  TSourceTable extends AnyStoreTable,
  TTargetTable extends AnyStoreTable,
  TSourceConnection extends SourceConnection<TSourceTable>,
  TTargetConnection extends TargetConnection<TTargetTable>,
>(
  options: SyncOptions<
    TSourceTable,
    TTargetTable,
    TSourceConnection,
    TTargetConnection
  >
): Trail<IdentityInputOf<TSourceTable>, EntityOf<TTargetTable>> => {
  const id = options.id ?? `${options.to.table.name}.sync`;
  const sourceContour = createTableContour(options.from.table);
  const targetContour = createTableContour(options.to.table);

  return trail<IdentityInputOf<TSourceTable>, EntityOf<TTargetTable>>(id, {
    // oxlint-disable-next-line max-statements -- sync blaze reads more clearly as one try/catch with schema validation, transform, and accessor call inline
    blaze: async (input, ctx) => {
      try {
        const identifier = input[
          options.from.table.identity as keyof typeof input
        ] as StoreIdentifierOf<TSourceTable>;
        const sourceEntity = await resolveSourceAccessor(options.from, ctx).get(
          identifier
        );

        if (sourceEntity === null) {
          return Result.err(sourceMissingError(options.from.table, identifier));
        }

        // No-transform path: the source entity is upserted directly into
        // the target table. The generic signature does not require the two
        // tables to be structurally compatible, so validate `next` against
        // the target table's fixture schema at runtime. This catches
        // accidentally omitted transforms before the underlying store sees
        // a mismatched payload.
        const next =
          options.transform === undefined
            ? options.to.table.fixtureSchema.safeParse(sourceEntity)
            : undefined;

        if (next !== undefined && !next.success) {
          return Result.err(
            new InternalError(
              `${id} produced an invalid target entity: ${next.error.message}`
            )
          );
        }

        const payload =
          options.transform === undefined
            ? (next?.data as unknown as UpsertOf<TTargetTable>)
            : await options.transform(sourceEntity, ctx);

        const synced = await resolveTargetAccessor(options.to, ctx).upsert(
          payload
        );
        return Result.ok(synced);
      } catch (error) {
        return Result.err(mapStoreTrailError(id, error));
      }
    },
    contours: [sourceContour, targetContour],
    description:
      options.description ??
      `Sync one "${options.from.table.name}" entity into "${options.to.table.name}".`,
    examples: deriveExamples(
      options.from.table,
      options.to.table,
      options.transform
    ) as
      | readonly TrailExample<
          IdentityInputOf<TSourceTable>,
          EntityOf<TTargetTable>
        >[]
      | undefined,
    input: identityInputSchema(options.from.table),
    intent: 'write',
    on: options.on,
    output: options.to.table.schema as unknown as z.ZodType<
      EntityOf<TTargetTable>
    >,
    resources: [options.from.resource, options.to.resource],
  });
};
