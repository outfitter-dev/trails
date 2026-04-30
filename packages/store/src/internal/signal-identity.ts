import {
  attachLateBoundSignalRef,
  cloneSignalWithId,
  signal,
  ValidationError,
} from '@ontrails/core';
import type { Signal } from '@ontrails/core';
import type { z } from 'zod';

import type {
  AnyStoreDefinition,
  AnyStoreTable,
  StoreTableSignals,
} from '../types.js';

type MutableTables<TStore extends AnyStoreDefinition> = {
  -readonly [TName in keyof TStore['tables']]: TStore['tables'][TName];
};

type StoreSignalEvent = 'created' | 'removed' | 'updated';

const createStoreSignalDescription = (
  tableName: string,
  event: StoreSignalEvent
): string => {
  switch (event) {
    case 'created': {
      return `Fired after a "${tableName}" entity is created.`;
    }
    case 'removed': {
      return `Fired after a "${tableName}" entity is removed.`;
    }
    case 'updated': {
      return `Fired after a "${tableName}" entity is updated.`;
    }
    default: {
      throw new Error(`Unsupported store signal event: ${event as string}`);
    }
  }
};

const createStoreSignal = <TPayload>(
  tableName: string,
  event: StoreSignalEvent,
  payload: z.ZodType<TPayload>
): Signal<TPayload> =>
  attachLateBoundSignalRef(
    signal(`${tableName}.${event}`, {
      description: createStoreSignalDescription(tableName, event),
      payload,
    }),
    {
      kind: 'store-derived',
      token: Bun.randomUUIDv7(),
    }
  );

export const createStoreTableSignals = <TPayload>(
  tableName: string,
  payload: z.ZodType<TPayload>
): StoreTableSignals<TPayload> =>
  Object.freeze({
    created: createStoreSignal(tableName, 'created', payload),
    removed: createStoreSignal(tableName, 'removed', payload),
    updated: createStoreSignal(tableName, 'updated', payload),
  });

export const composeStoreSignalId = (
  scope: string,
  tableName: string,
  event: StoreSignalEvent
): string => `${scope}:${tableName}.${event}`;

const bindTableSignals = (
  scope: string,
  table: AnyStoreTable
): StoreTableSignals<unknown> =>
  Object.freeze({
    created: cloneSignalWithId(
      table.signals.created,
      composeStoreSignalId(scope, table.name, 'created')
    ),
    removed: cloneSignalWithId(
      table.signals.removed,
      composeStoreSignalId(scope, table.name, 'removed')
    ),
    updated: cloneSignalWithId(
      table.signals.updated,
      composeStoreSignalId(scope, table.name, 'updated')
    ),
  });

const collectStoreSignals = <TStore extends AnyStoreDefinition>(
  normalized: MutableTables<TStore>,
  tableNames: readonly Extract<keyof TStore['tables'], string>[]
) =>
  Object.freeze(
    tableNames.flatMap((name) => {
      const table = normalized[name];
      return table === undefined
        ? []
        : [table.signals.created, table.signals.updated, table.signals.removed];
    })
  );

/**
 * Verifies that a resource id is safe to compose into a scoped signal id.
 *
 * Scoped signal ids are matched by the `SCOPED_SIGNAL_ID` pattern in
 * `@ontrails/core` (`^[^:\s]+:[^:.\s]+(?:\.[^:.\s]+)+$`). A resource id used
 * as the scope segment must therefore be a non-empty string that contains
 * neither `":"` nor any whitespace.
 */
export const isValidResourceId = (resourceId: string): boolean =>
  resourceId.length > 0 && !resourceId.includes(':') && !/\s/.test(resourceId);

const assertValidScope = (scope: string): void => {
  if (!isValidResourceId(scope)) {
    throw new ValidationError(
      `Store resource id "${scope}" is invalid: must be a non-empty string with no ":" characters and no whitespace.`
    );
  }
};

export const bindStoreDefinition = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  scope: string
): TStore => {
  assertValidScope(scope);

  const tableNames = definition.tableNames as readonly Extract<
    keyof TStore['tables'],
    string
  >[];
  const tables = {} as MutableTables<TStore>;

  for (const tableName of tableNames) {
    const table = definition.tables[tableName];
    if (table === undefined) {
      continue;
    }

    tables[tableName] = Object.freeze({
      ...table,
      signals: bindTableSignals(scope, table),
    }) as MutableTables<TStore>[typeof tableName];
  }

  const get =
    'get' in definition && typeof definition.get === 'function'
      ? <TName extends Extract<keyof TStore['tables'], string>>(name: TName) =>
          tables[name]
      : undefined;

  return Object.freeze({
    ...definition,
    ...(get ? { get } : {}),
    signals: collectStoreSignals(tables, tableNames),
    tables: Object.freeze(tables),
  }) as TStore;
};

export type { StoreSignalEvent };
