import { resource, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { incompleteAccessorForStandardOp } from '../rules/incomplete-accessor-for-standard-op.js';
import { wrapTopoRule } from './wrap-rule.js';

type Accessor = Readonly<Record<string, (...args: unknown[]) => unknown>>;
type Connection = Readonly<Record<string, Accessor>>;

const noop = (): undefined => undefined;

const buildResource = (id: string, contourName: string, accessor: Accessor) =>
  resource<Connection>(id, {
    create: () => Result.ok({ [contourName]: accessor }),
    mock: () => ({ [contourName]: accessor }),
  });

const buildCrudTrail = (
  trailId: string,
  resourceValue: ReturnType<typeof buildResource>
) =>
  trail(trailId, {
    blaze: () => Result.ok({ ok: true }),
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    pattern: 'crud',
    resources: [resourceValue],
  });

const cleanResource = buildResource('store.note.clean', 'note', {
  insert: noop,
});
const warningResource = buildResource('store.note.warn', 'note', {
  upsert: noop,
});

const cleanTopo = topo('trl-269-clean', {
  noteCreate: buildCrudTrail('note.create', cleanResource),
  noteResource: cleanResource,
});

const warningTopo = topo('trl-269-warning', {
  noteCreate: buildCrudTrail('note.create', warningResource),
  noteResource: warningResource,
});

export const incompleteAccessorForStandardOpTrail = wrapTopoRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        topo: cleanTopo,
      },
      name: 'Preferred accessors keep CRUD trails quiet',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Trail "note.create" (crud.create): resource "store.note.warn" accessor "note" is missing preferred method "insert"; falls back to "upsert"',
            rule: 'incomplete-accessor-for-standard-op',
            severity: 'warn',
          },
        ],
      },
      input: {
        topo: warningTopo,
      },
      name: 'Fallback-only create accessors emit a warning',
    },
  ],
  rule: incompleteAccessorForStandardOp,
});
