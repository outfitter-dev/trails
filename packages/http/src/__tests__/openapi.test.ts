import { describe, expect, test } from 'bun:test';

import { Result, ValidationError, signal, topo, trail } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import { z } from 'zod';

import { deriveOpenApiSpec } from '../openapi.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const topoFrom = (...modules: Record<string, unknown>[]): Topo =>
  topo('test-app', ...modules);

const noop = () => Result.ok(null as unknown);

/** Extract an operation from a spec by path and method. */
const getOperation = (
  spec: ReturnType<typeof deriveOpenApiSpec>,
  path: string,
  method: string
): Record<string, unknown> =>
  spec.paths[path]?.[method] as Record<string, unknown>;

/** Drill into a response to get the JSON schema. */
const getJsonSchema = (
  response: Record<string, unknown>
): Record<string, unknown> => {
  const content = response['content'] as Record<string, unknown>;
  const json = content['application/json'] as Record<string, unknown>;
  return json['schema'] as Record<string, unknown>;
};

const registerPathAndMethodTests = () => {
  describe('path and method derivation', () => {
    test('dotted trail ID becomes a path', () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));

      expect(spec.paths['/entity/show']).toBeDefined();
    });

    test('single-segment trail ID becomes a root path', () => {
      const t = trail('search', {
        blaze: noop,
        input: z.object({ q: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));

      expect(spec.paths['/search']).toBeDefined();
    });

    test('intent read → GET', () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));

      expect(spec.paths['/entity/show']?.['get']).toBeDefined();
    });

    test('intent destroy → DELETE', () => {
      const t = trail('entity.remove', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'destroy',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));

      expect(spec.paths['/entity/remove']?.['delete']).toBeDefined();
    });

    test('intent write (default) → POST', () => {
      const t = trail('entity.create', {
        blaze: noop,
        input: z.object({ name: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));

      expect(spec.paths['/entity/create']?.['post']).toBeDefined();
    });

    test('basePath is prepended to all paths', () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }), {
        basePath: '/api/v1',
      });

      expect(spec.paths['/api/v1/entity/show']).toBeDefined();
    });

    test('basePath trailing slash is normalized', () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }), {
        basePath: '/api/v1/',
      });

      expect(spec.paths['/api/v1/entity/show']).toBeDefined();
      expect(spec.paths['/api/v1//entity/show']).toBeUndefined();
    });

    test('same derived path with different methods keeps both operations', () => {
      const getItem = trail('item.resource', {
        blaze: noop,
        input: z.object({}),
        intent: 'read',
      });
      const createItem = trail('item/resource', {
        blaze: noop,
        input: z.object({ name: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ createItem, getItem }));

      expect(
        Object.keys(spec.paths['/item/resource'] ?? {}).toSorted()
      ).toEqual(['get', 'post']);
    });

    test('throws on duplicate method and path derivation', () => {
      const dotTrail = trail('entity.show', {
        blaze: noop,
        input: z.object({}),
        intent: 'read',
      });
      const slashTrail = trail('entity/show', {
        blaze: noop,
        input: z.object({}),
        intent: 'read',
      });

      expect(() =>
        deriveOpenApiSpec(topoFrom({ dotTrail, slashTrail }))
      ).toThrow(ValidationError);
      expect(() =>
        deriveOpenApiSpec(topoFrom({ dotTrail, slashTrail }))
      ).toThrow(
        'HTTP route collision: trails "entity.show" and "entity/show" both derive GET /entity/show'
      );
    });
  });
};

const registerGetQueryParameterTests = () => {
  describe('GET query parameters', () => {
    const buildReadSpec = () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string(), verbose: z.boolean().optional() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/show']?.['get'] as Record<string, unknown>;
      return op['parameters'] as Record<string, unknown>[];
    };

    test('produces one parameter per input field', () => {
      expect(buildReadSpec()).toHaveLength(2);
    });

    test('required field is marked required with in=query', () => {
      const idParam = buildReadSpec().find((p) => p['name'] === 'id');
      expect(idParam?.['in']).toBe('query');
      expect(idParam?.['required']).toBe(true);
    });

    test('optional field is marked not required', () => {
      const verboseParam = buildReadSpec().find((p) => p['name'] === 'verbose');
      expect(verboseParam).toBeDefined();
      expect(verboseParam?.['required']).toBe(false);
    });
  });
};

const registerRequestBodyTests = () => {
  describe('request body', () => {
    test('omits requestBody for empty input schema', () => {
      const t = trail('action.trigger', {
        blaze: noop,
        input: z.object({}),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/action/trigger']?.['post'] as Record<
        string,
        unknown
      >;

      expect(op['requestBody']).toBeUndefined();
    });

    test('POST input schema becomes requestBody', () => {
      const t = trail('entity.create', {
        blaze: noop,
        input: z.object({ name: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/create']?.['post'] as Record<
        string,
        unknown
      >;
      const body = op['requestBody'] as Record<string, unknown>;

      expect(body['required']).toBe(true);
      expect(body['content']).toBeDefined();
      const content = body['content'] as Record<string, unknown>;
      expect(content['application/json']).toBeDefined();
    });

    test('requestBody required is false when all input fields are optional', () => {
      const t = trail('entity.update', {
        blaze: noop,
        input: z.object({
          name: z.string().optional(),
          tag: z.string().optional(),
        }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/update']?.['post'] as Record<
        string,
        unknown
      >;
      const body = op['requestBody'] as Record<string, unknown>;

      expect(body['required']).toBe(false);
    });

    test('requestBody required is true when input has required fields', () => {
      const t = trail('entity.create', {
        blaze: noop,
        input: z.object({
          name: z.string(),
          tag: z.string().optional(),
        }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/create']?.['post'] as Record<
        string,
        unknown
      >;
      const body = op['requestBody'] as Record<string, unknown>;

      expect(body['required']).toBe(true);
    });
  });
};

const registerResponseTests = () => {
  describe('responses', () => {
    test('trail with output schema → 200 response wrapped in { data }', () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
        output: z.object({ id: z.string(), name: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const success = (
        getOperation(spec, '/entity/show', 'get')['responses'] as Record<
          string,
          unknown
        >
      )['200'] as Record<string, unknown>;
      const schema = getJsonSchema(success);

      expect(success['description']).toBe('Success');
      expect(schema['type']).toBe('object');
      expect(schema['required']).toEqual(['data']);
      const dataSchema = (schema['properties'] as Record<string, unknown>)[
        'data'
      ] as Record<string, unknown>;
      expect(dataSchema['type']).toBe('object');
    });

    test('trail without output → 200 with no schema', () => {
      const t = trail('fire.forget', {
        blaze: noop,
        input: z.object({ msg: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/fire/forget']?.['post'] as Record<
        string,
        unknown
      >;
      const responses = op['responses'] as Record<string, unknown>;
      const success = responses['200'] as Record<string, unknown>;

      expect(success['description']).toBe('Success');
      expect(success['content']).toBeUndefined();
    });

    test('trail with error examples → appropriate error responses', () => {
      const t = trail('entity.show', {
        blaze: noop,
        examples: [
          { input: { id: '123' }, name: 'found' },
          {
            error: 'NotFoundError',
            input: { id: 'missing' },
            name: 'not found',
          },
        ],
        input: z.object({ id: z.string() }),
        intent: 'read',
        output: z.object({ id: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/show']?.['get'] as Record<string, unknown>;
      const responses = op['responses'] as Record<string, unknown>;

      expect(responses['404']).toEqual({ description: 'NotFoundError' });
    });

    test('fixed-category error examples derive status codes from owner metadata', () => {
      const t = trail('entity.create', {
        blaze: noop,
        examples: [
          {
            error: 'PermitError',
            input: { name: 'Ada' },
            name: 'missing permit',
          },
          {
            error: 'DerivationError',
            input: { name: 'Ada' },
            name: 'projection failed',
          },
        ],
        input: z.object({ name: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/create']?.['post'] as Record<
        string,
        unknown
      >;
      const responses = op['responses'] as Record<string, unknown>;

      expect(responses['403']).toEqual({ description: 'PermitError' });
      expect(responses['500']).toEqual({ description: 'DerivationError' });
    });

    test('dynamic-category error examples are not projected to a fixed response code', () => {
      const t = trail('entity.create', {
        blaze: noop,
        examples: [
          {
            error: 'RetryExhaustedError',
            input: { name: 'Ada' },
            name: 'recovery exhausted',
          },
        ],
        input: z.object({ name: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/create']?.['post'] as Record<
        string,
        unknown
      >;
      const responses = op['responses'] as Record<string, unknown>;

      expect(Object.values(responses)).not.toContainEqual({
        description: 'RetryExhaustedError',
      });
    });

    test('every trail includes a default 400 validation error response', () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
        output: z.object({ id: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/show']?.['get'] as Record<string, unknown>;
      const fourHundred = (op['responses'] as Record<string, unknown>)[
        '400'
      ] as Record<string, unknown>;

      expect(fourHundred['description']).toBe('Validation error');
      expect(fourHundred['content']).toBeDefined();
      const schema = getJsonSchema(fourHundred);
      const errorProp = (schema['properties'] as Record<string, unknown>)[
        'error'
      ] as Record<string, unknown>;
      expect(errorProp['type']).toBe('object');
    });

    test('example-derived 400 does not override the default 400', () => {
      const t = trail('entity.show', {
        blaze: noop,
        examples: [{ error: 'ValidationError', input: {}, name: 'bad input' }],
        input: z.object({ id: z.string() }),
        intent: 'read',
        output: z.object({ id: z.string() }),
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/show']?.['get'] as Record<string, unknown>;
      const responses = op['responses'] as Record<string, unknown>;

      expect(responses['400']).toMatchObject({
        description: 'Validation error',
      });
      expect(
        getJsonSchema(responses['400'] as Record<string, unknown>)
      ).toEqual(
        expect.objectContaining({
          required: ['error'],
          type: 'object',
        })
      );
    });
  });
};

const registerMetadataAndStructureTests = () => {
  describe('operationId', () => {
    test('dots replaced with underscores', () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/show']?.['get'] as Record<string, unknown>;

      expect(op['operationId']).toBe('entity_show');
    });

    test('single segment ID preserved', () => {
      const t = trail('search', {
        blaze: noop,
        input: z.object({ q: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/search']?.['get'] as Record<string, unknown>;

      expect(op['operationId']).toBe('search');
    });

    test('throws on duplicate operationId derivation', () => {
      const dotTrail = trail('foo.bar', {
        blaze: noop,
        input: z.object({}),
        intent: 'read',
      });
      const underscoreTrail = trail('foo_bar', {
        blaze: noop,
        input: z.object({}),
        intent: 'read',
      });

      expect(() =>
        deriveOpenApiSpec(topoFrom({ dotTrail, underscoreTrail }))
      ).toThrow(ValidationError);
      expect(() =>
        deriveOpenApiSpec(topoFrom({ dotTrail, underscoreTrail }))
      ).toThrow(
        'OpenAPI operationId collision: trails "foo.bar" and "foo_bar" both derive operationId "foo_bar"'
      );
    });
  });

  describe('tags', () => {
    test('tag is first segment of dotted ID', () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/show']?.['get'] as Record<string, unknown>;

      expect(op['tags']).toEqual(['entity']);
    });

    test('single-segment ID uses itself as tag', () => {
      const t = trail('search', {
        blaze: noop,
        input: z.object({ q: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/search']?.['get'] as Record<string, unknown>;

      expect(op['tags']).toEqual(['search']);
    });
  });

  describe('multiple trails', () => {
    test('all trails populate paths', () => {
      const a = trail('entity.create', {
        blaze: noop,
        input: z.object({ name: z.string() }),
      });
      const b = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const c = trail('entity.remove', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'destroy',
      });
      const spec = deriveOpenApiSpec(topoFrom({ a, b, c }));

      expect(Object.keys(spec.paths)).toHaveLength(3);
      expect(spec.paths['/entity/create']?.['post']).toBeDefined();
      expect(spec.paths['/entity/show']?.['get']).toBeDefined();
      expect(spec.paths['/entity/remove']?.['delete']).toBeDefined();
    });
  });

  describe('internal trails', () => {
    test('trails with visibility internal are skipped', () => {
      const pub = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const internal = trail('internal.helper', {
        blaze: noop,
        input: z.object({}),
        visibility: 'internal',
      });
      const spec = deriveOpenApiSpec(topoFrom({ internal, pub }));

      expect(Object.keys(spec.paths)).toHaveLength(1);
      expect(spec.paths['/entity/show']).toBeDefined();
      expect(spec.paths['/internal/helper']).toBeUndefined();
    });
  });

  describe('consumer trails', () => {
    test('trails with on (signal consumers) are excluded', () => {
      const changed = signal('entity.changed', {
        payload: z.object({ id: z.string() }),
      });
      const pub = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const consumer = trail('entity.onChanged', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        on: [changed],
      });
      const spec = deriveOpenApiSpec(topoFrom({ changed, consumer, pub }));

      expect(Object.keys(spec.paths)).toHaveLength(1);
      expect(spec.paths['/entity/show']).toBeDefined();
      expect(spec.paths['/entity/onChanged']).toBeUndefined();
    });

    test('intent filters narrow the generated paths', () => {
      const readTrail = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const destroyTrail = trail('entity.remove', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'destroy',
      });

      const spec = deriveOpenApiSpec(topoFrom({ destroyTrail, readTrail }), {
        intent: ['read'],
      });

      expect(spec.paths['/entity/show']).toBeDefined();
      expect(spec.paths['/entity/remove']).toBeUndefined();
    });

    test('intent filters compose with include patterns using AND logic', () => {
      const readTrail = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const destroyTrail = trail('entity.remove', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'destroy',
      });

      const spec = deriveOpenApiSpec(topoFrom({ destroyTrail, readTrail }), {
        include: ['entity.*'],
        intent: ['destroy'],
      });

      expect(spec.paths['/entity/show']).toBeUndefined();
      expect(spec.paths['/entity/remove']).toBeDefined();
    });
  });

  describe('spec structure', () => {
    test('openapi version is 3.1.0', () => {
      const spec = deriveOpenApiSpec(topoFrom({}));

      expect(spec.openapi).toBe('3.1.0');
    });

    test('info defaults from topo name', () => {
      const spec = deriveOpenApiSpec(topoFrom({}));

      expect(spec.info.title).toBe('test-app');
      expect(spec.info.version).toBe('1.0.0');
    });

    test('info uses options when provided', () => {
      const spec = deriveOpenApiSpec(topoFrom({}), {
        description: 'Test API',
        title: 'My API',
        version: '2.0.0',
      });

      expect(spec.info.title).toBe('My API');
      expect(spec.info.version).toBe('2.0.0');
      expect(spec.info.description).toBe('Test API');
    });

    test('servers included when provided', () => {
      const spec = deriveOpenApiSpec(topoFrom({}), {
        servers: [{ description: 'Local', url: 'http://localhost:3000' }],
      });

      expect(spec.servers).toHaveLength(1);
      expect(spec.servers?.[0]?.url).toBe('http://localhost:3000');
    });

    test('servers omitted when not provided', () => {
      const spec = deriveOpenApiSpec(topoFrom({}));

      expect(spec.servers).toBeUndefined();
    });

    test('components.schemas is present (empty)', () => {
      const spec = deriveOpenApiSpec(topoFrom({}));

      expect(spec.components.schemas).toEqual({});
    });
  });

  describe('summary from description', () => {
    test('trail description becomes operation summary', () => {
      const t = trail('entity.show', {
        blaze: noop,
        description: 'Show an entity by ID',
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/show']?.['get'] as Record<string, unknown>;

      expect(op['summary']).toBe('Show an entity by ID');
    });

    test('trail without description has no summary', () => {
      const t = trail('entity.show', {
        blaze: noop,
        input: z.object({ id: z.string() }),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ t }));
      const op = spec.paths['/entity/show']?.['get'] as Record<string, unknown>;

      expect(op['summary']).toBeUndefined();
    });
  });

  describe('established graph enforcement', () => {
    test('rejects draft-contaminated topologies', () => {
      const exportTrail = trail('entity.export', {
        blaze: noop,
        crosses: ['_draft.entity.prepare'],
        input: z.object({}),
      });

      expect(() => deriveOpenApiSpec(topoFrom({ exportTrail }))).toThrowError(
        /draft/i
      );
    });

    test('rejects structural validation issues', () => {
      const exportTrail = trail('entity.export', {
        blaze: noop,
        crosses: ['entity.missing'],
        input: z.object({}),
      });

      expect(() => deriveOpenApiSpec(topoFrom({ exportTrail }))).toThrowError(
        /topo validation/i
      );
    });
  });

  describe('include / exclude filters', () => {
    test('include narrows the generated spec to matching trails', () => {
      const publicShow = trail('public.show', {
        blaze: noop,
        input: z.object({}),
        intent: 'read',
      });
      const privateShow = trail('private.show', {
        blaze: noop,
        input: z.object({}),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ privateShow, publicShow }), {
        include: ['public.*'],
      });

      expect(Object.keys(spec.paths)).toEqual(['/public/show']);
    });

    test('exclude removes matching trails from the generated spec', () => {
      const publicShow = trail('public.show', {
        blaze: noop,
        input: z.object({}),
        intent: 'read',
      });
      const publicHide = trail('public.hide', {
        blaze: noop,
        input: z.object({}),
        intent: 'read',
      });
      const spec = deriveOpenApiSpec(topoFrom({ publicHide, publicShow }), {
        exclude: ['public.hide'],
      });

      expect(Object.keys(spec.paths).toSorted()).toEqual(['/public/show']);
    });
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveOpenApiSpec', () => [
  registerPathAndMethodTests(),
  registerGetQueryParameterTests(),
  registerRequestBodyTests(),
  registerResponseTests(),
  registerMetadataAndStructureTests(),
]);
