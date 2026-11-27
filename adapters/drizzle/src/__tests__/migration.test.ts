import { afterEach, describe, expect, test } from 'bun:test';
import { store as defineStore } from '@ontrails/store';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { connectDrizzle } from '../index.js';

const legacyUserSchema = z.object({
  email: z.string().email(),
  id: z.string(),
});

const evolvedUserSchema = legacyUserSchema.extend({
  status: z.string(),
});

const legacyStore = defineStore({
  users: {
    primaryKey: 'id',
    schema: legacyUserSchema,
  },
});

const evolvedStore = defineStore({
  users: {
    primaryKey: 'id',
    schema: evolvedUserSchema,
  },
});

const createResourceInput = (rootDir: string) => ({
  config: undefined,
  cwd: rootDir,
  env: {},
  workspaceRoot: rootDir,
});

const unwrapCreated = async <T>(
  value:
    | PromiseLike<{
        unwrap(): T;
      }>
    | {
        unwrap(): T;
      }
): Promise<T> => {
  const result = await value;
  return result.unwrap();
};

const writeMigration = async (
  rootDir: string,
  tag: string,
  statements: readonly string[]
): Promise<string> => {
  const migrationsFolder = join(rootDir, 'migrations');
  const metadataFolder = join(migrationsFolder, 'meta');
  mkdirSync(metadataFolder, { recursive: true });
  await Bun.write(
    join(metadataFolder, '_journal.json'),
    `${JSON.stringify(
      {
        dialect: 'sqlite',
        entries: [
          {
            breakpoints: true,
            idx: 0,
            tag,
            version: '6',
            when: 1_700_000_000_000,
          },
        ],
        version: '7',
      },
      undefined,
      2
    )}\n`
  );
  await Bun.write(
    join(migrationsFolder, `${tag}.sql`),
    `${statements.join('\n--> statement-breakpoint\n')}\n`
  );
  return migrationsFolder;
};

interface DisposableResource<TConnection extends object> {
  dispose?: ((connection: TConnection) => Promise<void> | void) | undefined;
}

const createResourceTracker = () => {
  const disposals = new Map<object, () => Promise<void>>();

  return {
    async cleanup(): Promise<void> {
      let firstError: unknown;
      for (const [connection, dispose] of [
        ...disposals.entries(),
      ].toReversed()) {
        disposals.delete(connection);
        try {
          await dispose();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== undefined) {
        throw new Error('Failed to dispose migration fixture', {
          cause: firstError,
        });
      }
    },
    async dispose(connection: object): Promise<void> {
      const dispose = disposals.get(connection);
      if (dispose === undefined) {
        return;
      }
      disposals.delete(connection);
      await dispose();
    },
    register<TConnection extends object>(
      resource: DisposableResource<TConnection>,
      connection: TConnection
    ): TConnection {
      disposals.set(connection, async () => {
        await resource.dispose?.(connection);
      });
      return connection;
    },
  };
};

type ResourceTracker = ReturnType<typeof createResourceTracker>;

const setupLegacyStore = async (
  rootDir: string,
  resources: ResourceTracker
) => {
  const databasePath = join(rootDir, 'migration.sqlite');
  const resource = connectDrizzle(legacyStore, {
    id: 'migration.store',
    url: databasePath,
  });
  const connection = resources.register(
    resource,
    await unwrapCreated(resource.create(createResourceInput(rootDir)))
  );
  await connection.users.insert({
    email: 'before@example.com',
    id: 'user-1',
  });
  return { connection, databasePath };
};

const createTmpRootManager = () => {
  let rootDir: string | undefined;

  return {
    cleanup() {
      if (rootDir !== undefined) {
        rmSync(rootDir, { force: true, recursive: true });
        rootDir = undefined;
      }
    },
    makeRoot(): string {
      rootDir = mkdtempSync(join(tmpdir(), 'store-drizzle-migration-'));
      return rootDir;
    },
  };
};

describe('@ontrails/drizzle migrations', () => {
  const resources = createResourceTracker();
  const tmp = createTmpRootManager();

  afterEach(async () => {
    try {
      await resources.cleanup();
    } finally {
      tmp.cleanup();
    }
  });

  test('applies an authored migration once against a physical SQLite file', async () => {
    const rootDir = tmp.makeRoot();
    const { connection, databasePath } = await setupLegacyStore(
      rootDir,
      resources
    );
    const migrationsFolder = await writeMigration(
      rootDir,
      '0000_evolve_users',
      [
        'ALTER TABLE "users" ADD COLUMN "status" text NOT NULL DEFAULT \'pending\';',
        'CREATE TABLE "migration_effects" ("affected_rows" integer NOT NULL);',
        'CREATE TABLE "user_audit" ("user_id" text NOT NULL, "status" text NOT NULL);',
        'CREATE TRIGGER "users_status_audit" AFTER UPDATE OF "status" ON "users" BEGIN INSERT INTO "user_audit" ("user_id", "status") VALUES (NEW."id", NEW."status"); END;',
        'UPDATE "users" SET "status" = \'active\' WHERE "id" = \'user-1\';',
        'INSERT INTO "migration_effects" ("affected_rows") VALUES (changes());',
      ]
    );

    await connection.query(({ drizzle }) =>
      migrate(drizzle, { migrationsFolder })
    );

    const firstRun = await connection.query(({ drizzle }) => ({
      auditRows: drizzle.all<{ status: string; user_id: string }>(
        'SELECT "status", "user_id" FROM "user_audit"'
      ),
      effects: drizzle.all<{ affected_rows: number }>(
        'SELECT "affected_rows" FROM "migration_effects"'
      ),
      ledger: drizzle.all<{ count: number }>(
        'SELECT count(*) AS "count" FROM "__drizzle_migrations"'
      ),
    }));
    expect(firstRun.effects).toEqual([{ affected_rows: 1 }]);
    expect(firstRun.auditRows).toEqual([
      { status: 'active', user_id: 'user-1' },
    ]);
    expect(firstRun.ledger).toEqual([{ count: 1 }]);

    await connection.query(({ drizzle }) =>
      migrate(drizzle, { migrationsFolder })
    );
    const rerunCounts = await connection.query(({ drizzle }) => ({
      audit: drizzle.all<{ count: number }>(
        'SELECT count(*) AS "count" FROM "user_audit"'
      ),
      ledger: drizzle.all<{ count: number }>(
        'SELECT count(*) AS "count" FROM "__drizzle_migrations"'
      ),
    }));
    expect(rerunCounts).toEqual({
      audit: [{ count: 1 }],
      ledger: [{ count: 1 }],
    });

    const directUpdate = await connection.query(({ drizzle }) => {
      drizzle.run(
        'UPDATE "users" SET "status" = \'verified\' WHERE "id" = \'user-1\''
      );
      const affectedRows = drizzle.all<{ changes: number }>(
        'SELECT changes() AS "changes"'
      );
      const audit = drizzle.all<{ count: number }>(
        'SELECT count(*) AS "count" FROM "user_audit"'
      );
      return { affectedRows, audit };
    });
    expect(directUpdate).toEqual({
      affectedRows: [{ changes: 1 }],
      audit: [{ count: 2 }],
    });

    await resources.dispose(connection);
    const evolvedResource = connectDrizzle(evolvedStore, {
      id: 'migration.store.evolved',
      url: databasePath,
    });
    const evolvedConnection = resources.register(
      evolvedResource,
      await unwrapCreated(evolvedResource.create(createResourceInput(rootDir)))
    );
    expect(await evolvedConnection.users.get('user-1')).toEqual({
      email: 'before@example.com',
      id: 'user-1',
      status: 'verified',
    });
    await resources.dispose(evolvedConnection);
  });

  test('rolls back every migration statement when a middle statement fails', async () => {
    const rootDir = tmp.makeRoot();
    const { connection, databasePath } = await setupLegacyStore(
      rootDir,
      resources
    );
    const migrationsFolder = await writeMigration(
      rootDir,
      '0000_broken_users',
      [
        'CREATE TABLE "partial_artifact" ("id" text NOT NULL);',
        'UPDATE "users" SET "email" = \'mutated@example.com\' WHERE "id" = \'user-1\';',
        'THIS IS NOT VALID SQL;',
        'CREATE TRIGGER "never_created" AFTER UPDATE ON "users" BEGIN INSERT INTO "partial_artifact" ("id") VALUES (NEW."id"); END;',
      ]
    );

    await expect(
      connection.query(({ drizzle }) => migrate(drizzle, { migrationsFolder }))
    ).rejects.toThrow();

    await resources.dispose(connection);
    const reopenedResource = connectDrizzle(legacyStore, {
      id: 'migration.store.reopened',
      url: databasePath,
    });
    const reopenedConnection = resources.register(
      reopenedResource,
      await unwrapCreated(reopenedResource.create(createResourceInput(rootDir)))
    );
    expect(await reopenedConnection.users.get('user-1')).toEqual({
      email: 'before@example.com',
      id: 'user-1',
    });
    const rollbackState = await reopenedConnection.query(({ drizzle }) => ({
      artifacts: drizzle.all<{ name: string }>(
        'SELECT "name" FROM "sqlite_master" WHERE "name" IN (\'partial_artifact\', \'never_created\') ORDER BY "name"'
      ),
      ledger: drizzle.all<{ count: number }>(
        'SELECT count(*) AS "count" FROM "__drizzle_migrations"'
      ),
    }));
    expect(rollbackState).toEqual({
      artifacts: [],
      ledger: [{ count: 0 }],
    });
    await resources.dispose(reopenedConnection);
  });
});
