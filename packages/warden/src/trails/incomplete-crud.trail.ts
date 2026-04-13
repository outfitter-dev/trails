import { incompleteCrud } from '../rules/incomplete-crud.js';
import { wrapRule } from './wrap-rule.js';

export const incompleteCrudTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'clean.ts',
        sourceCode: `import { Result, resource } from '@ontrails/core';
import { store } from '@ontrails/store';
import { crud } from '@ontrails/store/trails';
import { z } from 'zod';

const db = store({
  notes: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      title: z.string(),
    }),
  },
});

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const [createNote, readNote, updateNote, deleteNote, listNote] = crud(
  db.tables.notes,
  notesResource
);`,
      },
      name: 'Full CRUD coverage stays quiet',
    },
  ],
  rule: incompleteCrud,
});
