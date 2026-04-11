import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { contour } from '../contour.js';
import { Result } from '../result.js';
import { resource } from '../resource.js';
import type { DeriveTrailOperation } from '../trails/index.js';
import { deriveTrail } from '../trails/index.js';

const note = contour(
  'note',
  {
    body: z.string().default('draft'),
    createdAt: z.string(),
    id: z.string(),
    title: z.string(),
  },
  {
    examples: [
      {
        body: 'Hello, Trails',
        createdAt: '2026-04-10T12:00:00.000Z',
        id: 'note-1',
        title: 'First note',
      },
    ],
    identity: 'id',
  }
);

const noteResource = resource('db.notes', {
  create: () =>
    Result.ok({
      name: 'notes',
    }),
});

const noteExample = note.examples?.[0];

const createBlaze = () => Result.ok(noteExample);
const deleteBlaze = () => Result.ok();
const listBlaze = () => Result.ok([noteExample]);

const unsupportedOperation = (operation: never): never => {
  throw new TypeError(`Unsupported test operation: ${String(operation)}`);
};

const deriveNoteTrail = <TOperation extends DeriveTrailOperation>(
  operation: TOperation
) => {
  switch (operation) {
    case 'create': {
      return deriveTrail(note, operation, {
        blaze: createBlaze,
        generated: ['id', 'createdAt'],
        resource: noteResource,
      });
    }
    case 'read': {
      return deriveTrail(note, operation, {
        blaze: createBlaze,
        resource: noteResource,
      });
    }
    case 'update': {
      return deriveTrail(note, operation, {
        blaze: createBlaze,
        generated: ['id', 'createdAt'],
        resource: noteResource,
      });
    }
    case 'delete': {
      return deriveTrail(note, operation, {
        blaze: deleteBlaze,
        resource: noteResource,
      });
    }
    case 'list': {
      return deriveTrail(note, operation, {
        blaze: listBlaze,
        resource: noteResource,
      });
    }
    default: {
      return unsupportedOperation(operation);
    }
  }
};

const deriveCrudTrails = () => ({
  created: deriveNoteTrail('create'),
  listed: deriveNoteTrail('list'),
  read: deriveNoteTrail('read'),
  removed: deriveNoteTrail('delete'),
  updated: deriveNoteTrail('update'),
});

const expectTrailMetadata = (
  trail: ReturnType<typeof deriveNoteTrail>,
  expectedId: string,
  expectedIntent: 'destroy' | 'read' | 'write'
) => {
  expect(trail.id).toBe(expectedId);
  expect(trail.intent).toBe(expectedIntent);
};

const expectCreateSchemas = (
  created: ReturnType<typeof deriveNoteTrail<'create'>>
) => {
  expect(
    created.input.safeParse({ body: 'Body', title: 'Created note' }).success
  ).toBe(true);
  expect(
    created.input.parse({
      createdAt: '2026-04-10T12:00:00.000Z',
      id: 'note-1',
      title: 'Created note',
    })
  ).toEqual({ body: 'draft', title: 'Created note' });
  expect(created.output?.safeParse(note.examples?.[0]).success).toBe(true);
};

const expectReadSchemas = (
  read: ReturnType<typeof deriveNoteTrail<'read'>>
) => {
  expect(read.input.safeParse({ id: 'note-1' }).success).toBe(true);
  expect(read.input.safeParse({ title: 'Nope' }).success).toBe(false);
  expect(read.output?.safeParse(note.examples?.[0]).success).toBe(true);
};

const expectUpdateSchemas = (
  updated: ReturnType<typeof deriveNoteTrail<'update'>>
) => {
  expect(updated.input.safeParse({ id: 'note-1' }).success).toBe(true);
  expect(
    updated.input.safeParse({ body: 'Updated', id: 'note-1' }).success
  ).toBe(true);
  expect(
    updated.input.parse({
      createdAt: '2026-04-10T12:00:00.000Z',
      id: 'note-1',
    })
  ).toEqual({ id: 'note-1' });
};

const expectDeleteSchemas = (
  removed: ReturnType<typeof deriveNoteTrail<'delete'>>
) => {
  expect(removed.input.safeParse({ id: 'note-1' }).success).toBe(true);
  expect(removed.output?.safeParse().success).toBe(true);
  expect(removed.output?.safeParse(note.examples?.[0]).success).toBe(false);
};

const expectListSchemas = (
  listed: ReturnType<typeof deriveNoteTrail<'list'>>
) => {
  expect(listed.input.safeParse({}).success).toBe(true);
  expect(listed.input.safeParse({ id: 'note-1' }).success).toBe(true);
  expect(listed.output?.safeParse([note.examples?.[0]]).success).toBe(true);
};

describe('deriveTrail()', () => {
  test('derives trail ids, intents, contours, and resources for CRUD operations', () => {
    const { created, listed, read, removed, updated } = deriveCrudTrails();

    expectTrailMetadata(created, 'note.create', 'write');
    expectTrailMetadata(read, 'note.read', 'read');
    expectTrailMetadata(updated, 'note.update', 'write');
    expectTrailMetadata(removed, 'note.delete', 'destroy');
    expectTrailMetadata(listed, 'note.list', 'read');

    expect(created.contours).toEqual([note]);
    expect(created.resources).toEqual([noteResource]);
  });

  test('derives input and output schemas for each CRUD operation', () => {
    const { created, listed, read, removed, updated } = deriveCrudTrails();

    expectCreateSchemas(created);
    expectReadSchemas(read);
    expectUpdateSchemas(updated);
    expectDeleteSchemas(removed);
    expectListSchemas(listed);
  });

  test('derives per-operation examples from contour examples', () => {
    const { created, listed, read, removed, updated } = deriveCrudTrails();

    expect(created.examples).toEqual([
      {
        expected: note.examples?.[0],
        input: { body: 'Hello, Trails', title: 'First note' },
        name: 'Create note note-1',
      },
    ]);
    expect(read.examples).toEqual([
      {
        expected: note.examples?.[0],
        input: { id: 'note-1' },
        name: 'Read note note-1',
      },
    ]);
    expect(updated.examples).toEqual([
      {
        expected: note.examples?.[0],
        input: { body: 'Hello, Trails', id: 'note-1', title: 'First note' },
        name: 'Update note note-1',
      },
    ]);
    expect(removed.examples).toEqual([
      {
        input: { id: 'note-1' },
        name: 'Delete note note-1',
      },
    ]);
    expect(listed.examples).toEqual([
      {
        expected: [note.examples?.[0]],
        input: { id: 'note-1' },
        name: 'List note note-1',
      },
    ]);
  });

  test('requires a custom blaze implementation', () => {
    expect(() =>
      deriveTrail(note, 'create', {
        generated: ['id', 'createdAt'],
        resource: noteResource,
      } as never)
    ).toThrow('deriveTrail("note.create") requires a blaze implementation');
  });

  test('drops schema defaults from update and list filters', () => {
    const updated = deriveNoteTrail('update');
    const listed = deriveNoteTrail('list');

    expect(updated.input.parse({ id: 'note-1' })).toEqual({ id: 'note-1' });
    expect(listed.input.parse({})).toEqual({});
  });
});
