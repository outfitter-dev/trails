import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConflictError,
  createObserveLogger,
  createTrailContext,
  Result,
  run,
  topo,
  trail,
} from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { connectJsonFile, jsonFile } from '../jsonfile/index.js';
import { store } from '../store.js';

const noteSchema = z.object({ id: z.string(), title: z.string() });
const definition = store({ notes: { identity: 'id', schema: noteSchema } });
let dir: string;

const recorder = () => {
  const events: { id: string; payload: unknown }[] = [];
  const fire: NonNullable<TrailContext['fire']> = (signal, payload) => {
    events.push({ id: signal.id, payload });
    return Promise.resolve();
  };
  return { events, fire };
};

const provision = async () => {
  const db = jsonFile(definition, { dir, id: 'notes.db' });
  const raw = await connectJsonFile(definition, { dir });
  const signals = recorder();
  const ctx = createTrailContext({
    extensions: { [db.id]: raw },
    fire: signals.fire,
  });
  return { bound: db.from(ctx), ctx, db, raw, ...signals };
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jsonfile-signals-'));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe('JSON-file context-bound signals', () => {
  test('activates the consumer of a pre-bind created handle after a successful write', async () => {
    const db = jsonFile(definition, { dir, id: 'repro.db' });
    const seen: unknown[] = [];
    const producer = trail('notes.write', {
      implementation: async (input, ctx) =>
        Result.ok(await db.from(ctx).notes.upsert(input)),
      input: noteSchema,
      intent: 'write',
      resources: [db],
    });
    const consumer = trail('notes.observe', {
      implementation(input) {
        seen.push(input);
        return Result.ok({ seen: true });
      },
      input: noteSchema,
      on: [definition.tables.notes.signals.created],
    });
    const app = topo('jsonfile-signals-repro', { consumer, db, producer });
    expect(app.get('notes.observe')?.on).toContain('repro.db:notes.created');
    const input = { id: 'one', title: 'First' };
    const result = await run(app, 'notes.write', input);
    expect(result.isOk()).toBe(true);
    await Bun.sleep(500);
    expect(seen).toEqual([input]);
  });

  test('emits persisted created, changed updated, and removed snapshots with scoped IDs', async () => {
    const { bound, events } = await provision();
    const original = { id: 'one', title: 'First' };
    const updated = { ...original, title: 'Second' };
    expect(await bound.notes.upsert(original)).toEqual(original);
    expect(await Bun.file(join(dir, 'notes.json')).json()).toEqual([original]);
    await bound.notes.upsert(original);
    await bound.notes.upsert(updated);
    expect(await bound.notes.remove('one')).toEqual({ deleted: true });
    expect(await bound.notes.remove('missing')).toEqual({ deleted: false });
    expect(events).toEqual([
      { id: 'notes.db:notes.created', payload: original },
      { id: 'notes.db:notes.updated', payload: updated },
      { id: 'notes.db:notes.removed', payload: updated },
    ]);
  });

  test('keeps raw connections, unbound contexts, and reads silent', async () => {
    const { bound, db, raw, events } = await provision();
    const ctx = createTrailContext({ extensions: { [db.id]: raw } });
    expect(db.from(ctx)).toBe(raw);
    await raw.notes.upsert({ id: 'raw', title: 'Raw' });
    await db.from(ctx).notes.upsert({ id: 'unbound', title: 'Unbound' });
    await bound.notes.get('raw');
    await bound.notes.list();
    await raw.notes.remove('raw');
    expect(events).toEqual([]);
  });

  test('recognizes an existing empty-string identity as an update', async () => {
    const { bound, events } = await provision();
    const first = { id: '', title: 'First' };
    const updated = { id: '', title: 'Second' };
    await bound.notes.upsert(first);
    await bound.notes.upsert(updated);
    expect(events).toEqual([
      { id: 'notes.db:notes.created', payload: first },
      { id: 'notes.db:notes.updated', payload: updated },
    ]);
  });

  test('does not emit or change the index when an upsert or remove fails to persist', async () => {
    const { bound, events } = await provision();
    const original = { id: 'one', title: 'First' };
    await bound.notes.upsert(original);
    events.length = 0;
    const path = join(dir, 'notes.json');
    await rm(path);
    await mkdir(path);
    await expect(
      bound.notes.upsert({ ...original, title: 'Failed' })
    ).rejects.toThrow();
    await expect(
      bound.notes.upsert({ id: 'failed', title: 'Failed' })
    ).rejects.toThrow();
    await expect(bound.notes.remove('one')).rejects.toThrow();
    expect(await bound.notes.list()).toEqual([original]);
    expect(events).toEqual([]);
    await rm(path, { recursive: true });
    await bound.notes.remove('one');
    expect(events).toEqual([
      { id: 'notes.db:notes.removed', payload: original },
    ]);
  });

  test('uses generated identities and versioned rows and emits nothing on conflict', async () => {
    const versioned = store({
      notes: {
        generated: ['id'],
        identity: 'id',
        schema: noteSchema,
        versioned: true,
      },
    });
    const db = jsonFile(versioned, {
      dir,
      generateIdentity: () => 'generated',
      id: 'versions',
    });
    const raw = await db.mock?.();
    const { events, fire } = recorder();
    const bound = db.from(
      createTrailContext({ extensions: { [db.id]: raw }, fire })
    );
    const created = await bound.notes.upsert({ title: 'First' });
    const updated = await bound.notes.upsert(created);
    await expect(bound.notes.upsert(created)).rejects.toBeInstanceOf(
      ConflictError
    );
    expect(created).toEqual({ id: 'generated', title: 'First', version: 1 });
    expect(updated).toEqual({ ...created, version: 2 });
    expect(events).toEqual([
      { id: 'versions:notes.created', payload: created },
      { id: 'versions:notes.updated', payload: updated },
    ]);
  });

  test('classifies concurrent same-ID writes inside the table lock without leaking contexts', async () => {
    const { db, raw } = await provision();
    const first = recorder();
    const second = recorder();
    const a = db.from(
      createTrailContext({ extensions: { [db.id]: raw }, fire: first.fire })
    );
    const b = db.from(
      createTrailContext({ extensions: { [db.id]: raw }, fire: second.fire })
    );
    const initial = { id: 'one', title: 'First' };
    const updated = { id: 'one', title: 'Second' };
    await Promise.all([a.notes.upsert(initial), b.notes.upsert(updated)]);
    expect(first.events).toEqual([
      { id: 'notes.db:notes.created', payload: initial },
    ]);
    expect(second.events).toEqual([
      { id: 'notes.db:notes.updated', payload: updated },
    ]);
    await Promise.all([a.notes.remove('one'), b.notes.remove('one')]);
    expect(first.events.at(-1)).toEqual({
      id: 'notes.db:notes.removed',
      payload: updated,
    });
    expect(second.events).toHaveLength(1);
  });

  test('snapshots a removal after an already queued update', async () => {
    const { bound, events } = await provision();
    await bound.notes.upsert({ id: 'one', title: 'First' });
    events.length = 0;
    const updated = { id: 'one', title: 'Second' };
    await Promise.all([bound.notes.upsert(updated), bound.notes.remove('one')]);
    expect(events).toEqual([
      { id: 'notes.db:notes.updated', payload: updated },
      { id: 'notes.db:notes.removed', payload: updated },
    ]);
  });

  test('binds separate resource scopes sharing one file without mutating cached accessors', async () => {
    const { db, raw, bound, events } = await provision();
    const other = jsonFile(definition, { dir, id: 'other.db' });
    const shared = await connectJsonFile(definition, { dir });
    expect(shared.notes).toBe(raw.notes);
    const next = recorder();
    const ctx = createTrailContext({
      extensions: { [other.id]: shared },
      fire: next.fire,
    });
    await Promise.all([
      bound.notes.upsert({ id: 'one', title: db.id }),
      other.from(ctx).notes.upsert({ id: 'two', title: other.id }),
    ]);
    expect(events.map((event) => event.id)).toEqual(['notes.db:notes.created']);
    expect(next.events.map((event) => event.id)).toEqual([
      'other.db:notes.created',
    ]);
    await raw.notes.upsert({ id: 'three', title: 'Raw' });
    expect(events).toHaveLength(1);
    expect(next.events).toHaveLength(1);
  });

  test('rebinds a previously bound connection to the current context', async () => {
    const { db, bound, events } = await provision();
    const next = recorder();
    const ctx = createTrailContext({
      extensions: { [db.id]: bound },
      fire: next.fire,
    });
    await db.from(ctx).notes.upsert({ id: 'one', title: 'Next context' });
    expect(events).toEqual([]);
    expect(next.events).toHaveLength(1);
    const unbound = db.from(
      createTrailContext({ extensions: { [db.id]: bound } })
    );
    await unbound.notes.upsert({ id: 'two', title: 'No fire' });
    expect(events).toEqual([]);
    expect(next.events).toHaveLength(1);
  });

  test('awaits emission after persistence but releases the write lock before consumers run', async () => {
    const { db, raw } = await provision();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const fire: NonNullable<TrailContext['fire']> = async () => {
      expect(await Bun.file(join(dir, 'notes.json')).json()).toEqual([
        { id: 'one', title: 'First' },
      ]);
      await raw.notes.upsert({ id: 'nested', title: 'Consumer write' });
      entered.resolve();
      await release.promise;
    };
    const bound = db.from(
      createTrailContext({ extensions: { [db.id]: raw }, fire })
    );
    let settled = false;
    const pending = bound.notes
      .upsert({ id: 'one', title: 'First' })
      .then((value) => {
        settled = true;
        return value;
      });
    await entered.promise;
    expect(settled).toBe(false);
    release.resolve();
    expect(await pending).toEqual({ id: 'one', title: 'First' });
    expect(await raw.notes.get('nested')).toEqual({
      id: 'nested',
      title: 'Consumer write',
    });
  });

  test('logs a thrown emission error without masking the successful write', async () => {
    const { db, raw } = await provision();
    const error = new Error('Consumer failure');
    const warnings: unknown[] = [];
    const logger = createObserveLogger(
      {
        name: 'test',
        write: (record) => {
          warnings.push(record);
        },
      },
      'test',
      {}
    );
    const fire: NonNullable<TrailContext['fire']> = () => Promise.reject(error);
    const bound = db.from(
      createTrailContext({ extensions: { [db.id]: raw }, fire, logger })
    );
    const input = { id: 'one', title: 'Persisted' };
    expect(await bound.notes.upsert(input)).toEqual(input);
    expect(await raw.notes.get('one')).toEqual(input);
    expect(warnings).toEqual([
      expect.objectContaining({
        level: 'warn',
        message:
          'Signal "notes.db:notes.created" emission threw after a successful write',
        metadata: expect.objectContaining({ error }),
      }),
    ]);
  });
});
