import {
  NotFoundError,
  Result,
  surfaceOverlay,
  topo,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

interface OutputCase {
  readonly id: string;
  readonly schema: z.ZodType;
  readonly type: string | undefined;
  readonly value: unknown;
}

const mixed = z.union([z.object({ data: z.string() }), z.string()]);

export const outputCases: readonly OutputCase[] = [
  { id: 'text', schema: z.string(), type: 'string', value: 'hello' },
  { id: 'zero', schema: z.number(), type: 'number', value: 0 },
  { id: 'false', schema: z.boolean(), type: 'boolean', value: false },
  { id: 'empty', schema: z.string(), type: 'string', value: '' },
  { id: 'null', schema: z.null(), type: 'null', value: null },
  { id: 'array', schema: z.array(z.number()), type: 'array', value: [1, 2] },
  {
    id: 'object',
    schema: z.object({ data: z.string() }),
    type: 'object',
    value: { data: 'authored' },
  },
  {
    id: 'mixedobject',
    schema: mixed,
    type: undefined,
    value: { data: 'branch' },
  },
  { id: 'mixedstring', schema: mixed, type: undefined, value: 'branch' },
];

const nested = Object.fromEntries(
  outputCases.map(({ id, schema, value }) => [
    id,
    trail(`shape.${id}`, {
      implementation: () => Result.ok(value),
      input: z.object({}),
      output: schema,
      permit: 'public',
    }),
  ])
);

// Exercises compatibility for callers that predate the output-schema requirement.
const implicit = trail('shape.implicit', {
  implementation: () => Result.ok([1, 2]),
  input: z.object({}),
  permit: 'public',
});

const missing = trail('shape.missing', {
  implementation: () => Result.err(new NotFoundError('Missing fixture')),
  input: z.object({}),
  output: z.string(),
  permit: 'public',
});

export const outputApp = topo('output', { ...nested, implicit, missing });

export const outputOptions = {
  overlays: [
    surfaceOverlay({
      mcp: Object.fromEntries(
        [...outputCases.map(({ id }) => id), 'implicit', 'missing'].map(
          (id) => [`direct_${id}`, `shape.${id}`]
        )
      ),
    }),
  ],
  trailheads: { shapes: { description: 'Shape fixtures', trails: 'shape.*' } },
};
