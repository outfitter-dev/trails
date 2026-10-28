import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { deriveConfigSecretFields } from '../index.js';
import { deprecated, env, secret } from '../extensions.js';

describe('deriveConfigSecretFields', () => {
  test('projects only explicitly sensitive fields and local requiredness', () => {
    const schema = z.object({
      defaulted: secret(env(z.string(), 'DEFAULTED')).default(
        'private-default'
      ),
      nullable: secret(env(z.string(), 'NULLABLE')).nullable(),
      optional: secret(env(z.string(), 'OPTIONAL')).optional(),
      required: secret(env(z.string(), 'REQUIRED')),
      sensitive: secret(z.string()),
      visible: env(z.string(), 'VISIBLE'),
    });

    expect(deriveConfigSecretFields(schema)).toEqual({
      complete: true,
      fields: [
        {
          ancestors: [],
          env: 'DEFAULTED',
          path: 'defaulted',
          required: false,
          secret: true,
        },
        {
          ancestors: [],
          env: 'NULLABLE',
          path: 'nullable',
          required: true,
          secret: true,
        },
        {
          ancestors: [],
          env: 'OPTIONAL',
          path: 'optional',
          required: false,
          secret: true,
        },
        {
          ancestors: [],
          env: 'REQUIRED',
          path: 'required',
          required: true,
          secret: true,
        },
        { ancestors: [], path: 'sensitive', required: true, secret: true },
      ],
    });
  });

  test('keeps ancestor wrapper facts separate from leaf requiredness', () => {
    const schema = z.object({
      nested: z
        .object({ token: secret(env(z.string(), 'TOKEN')) })
        .optional()
        .nullable()
        .default({ token: 'private' }),
    });
    expect(deriveConfigSecretFields(schema)).toEqual({
      complete: true,
      fields: [
        {
          ancestors: [
            { defaulted: true, nullable: true, optional: true, path: 'nested' },
          ],
          env: 'TOKEN',
          path: 'nested.token',
          required: true,
          secret: true,
        },
      ],
    });
  });

  test('selects a required branch without evaluating its root default', () => {
    let defaults = 0;
    const schema = z
      .discriminatedUnion('adapter', [
        z.object({ adapter: z.literal('none') }).readonly(),
        z
          .object({
            adapter: z.literal('jwt'),
            token: secret(env(z.string(), 'TOKEN')),
          })
          .readonly(),
      ])
      .default(() => {
        defaults += 1;
        return { adapter: 'none' as const };
      });

    expect(
      deriveConfigSecretFields(schema, { discriminants: { adapter: 'jwt' } })
    ).toEqual({
      complete: true,
      fields: [
        {
          ancestors: [
            { defaulted: true, nullable: false, optional: false, path: '' },
          ],
          env: 'TOKEN',
          path: 'token',
          required: true,
          secret: true,
        },
      ],
    });
    expect(defaults).toBe(0);
    expect(
      deriveConfigSecretFields(schema, { discriminants: { adapter: 'none' } })
    ).toEqual({ complete: true, fields: [] });
  });

  test('matches optional JWT-secret metadata without executing cross-field refinement', () => {
    let refinements = 0;
    const schema = z
      .discriminatedUnion('adapter', [
        z.object({ adapter: z.literal('none') }).readonly(),
        z
          .object({
            adapter: z.literal('jwt'),
            allowedAlgorithms: z
              .array(z.enum(['HS256', 'RS256']))
              .readonly()
              .optional(),
            audience: z.string().optional(),
            issuer: z.string().optional(),
            secret: secret(env(z.string(), 'JWT_SECRET')).optional(),
          })
          .refine(() => {
            refinements += 1;
            return false;
          })
          .readonly(),
      ])
      .default({ adapter: 'none' });

    expect(
      deriveConfigSecretFields(schema, { discriminants: { adapter: 'jwt' } })
    ).toEqual({
      complete: true,
      fields: [
        {
          ancestors: [
            { defaulted: true, nullable: false, optional: false, path: '' },
          ],
          env: 'JWT_SECRET',
          path: 'secret',
          required: false,
          secret: true,
        },
      ],
    });
    expect(refinements).toBe(0);
  });

  test('selects nested branches by full field path', () => {
    const schema = z.object({
      auth: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('key'),
          pepper: secret(env(z.string(), 'PEPPER')),
        }),
        z.object({ kind: z.literal('none') }),
      ]),
    });
    expect(
      deriveConfigSecretFields(schema, {
        discriminants: { 'auth.kind': 'key' },
      })
    ).toEqual({
      complete: true,
      fields: [
        {
          ancestors: [],
          env: 'PEPPER',
          path: 'auth.pepper',
          required: true,
          secret: true,
        },
      ],
    });
  });

  test('reports missing and invalid branch selections without echoing literals', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none') }),
    ]);
    expect(deriveConfigSecretFields(schema)).toEqual({
      complete: false,
      path: 'kind',
      reason: 'missing-discriminant',
    });
    const result = deriveConfigSecretFields(schema, {
      discriminants: { kind: 'DO_NOT_RETURN_THIS' },
    });
    expect(result).toEqual({
      complete: false,
      path: 'kind',
      reason: 'invalid-discriminant',
    });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_RETURN_THIS');
  });

  test('rejects unsupported unions and transforms without executing them', () => {
    let transforms = 0;
    expect(deriveConfigSecretFields(z.union([z.string(), z.number()]))).toEqual(
      { complete: false, path: '', reason: 'unsupported-schema' }
    );
    const schema = z.object({
      token: secret(env(z.string(), 'TOKEN')).transform(() => {
        transforms += 1;
        return 'private';
      }),
    });
    expect(deriveConfigSecretFields(schema)).toEqual({
      complete: false,
      path: 'token',
      reason: 'unsupported-schema',
    });
    expect(transforms).toBe(0);
    const lazy = z.lazy(() => {
      transforms += 1;
      return z.string();
    });
    expect(deriveConfigSecretFields(lazy)).toEqual({
      complete: false,
      path: '',
      reason: 'unsupported-schema',
    });
    expect(transforms).toBe(0);
  });

  test('does not inspect requirements from an unselected branch', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none') }),
      z.object({
        kind: z.literal('key'),
        token: secret(z.string()).transform(() => {
          throw new Error('must not execute');
        }),
      }),
    ]);
    expect(
      deriveConfigSecretFields(schema, { discriminants: { kind: 'none' } })
    ).toEqual({ complete: true, fields: [] });
  });

  test('rejects sensitive discriminators and ambiguous field paths', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: secret(z.literal('key')) }),
    ]);
    expect(
      deriveConfigSecretFields(schema, { discriminants: { kind: 'key' } })
    ).toEqual({ complete: false, path: 'kind', reason: 'unsupported-schema' });
    expect(
      deriveConfigSecretFields(z.object({ 'a.b': secret(z.string()) }))
    ).toEqual({ complete: false, path: '', reason: 'unsupported-schema' });
    expect(deriveConfigSecretFields(secret(z.literal()))).toEqual({
      complete: false,
      path: '',
      reason: 'unsupported-schema',
    });
  });

  test('does not turn uninspected array elements into empty success', () => {
    expect(
      deriveConfigSecretFields(
        z.object({ keys: z.array(secret(env(z.string(), 'KEY'))) })
      )
    ).toEqual({ complete: false, path: 'keys', reason: 'unsupported-schema' });
    expect(
      deriveConfigSecretFields(
        z.object({ rows: z.array(z.object({ token: secret(z.string()) })) })
      )
    ).toEqual({ complete: false, path: 'rows', reason: 'unsupported-schema' });
    expect(
      deriveConfigSecretFields(
        z.object({ keys: z.array(env(secret(z.string()).optional(), 'KEY')) })
      )
    ).toEqual({ complete: false, path: 'keys', reason: 'unsupported-schema' });
    expect(
      deriveConfigSecretFields(
        z.object({ keys: secret(env(z.array(z.string()), 'KEYS')).optional() })
      )
    ).toEqual({
      complete: true,
      fields: [
        {
          ancestors: [],
          env: 'KEYS',
          path: 'keys',
          required: false,
          secret: true,
        },
      ],
    });
  });

  test('preserves metadata split across supported wrappers', () => {
    const schema = z.object({
      token: env(secret(z.string()).optional(), 'TOKEN'),
    });
    expect(deriveConfigSecretFields(schema)).toEqual({
      complete: true,
      fields: [
        {
          ancestors: [],
          env: 'TOKEN',
          path: 'token',
          required: false,
          secret: true,
        },
      ],
    });
  });

  test('excludes defaults, examples, descriptions, and schema internals', () => {
    const sentinel = 'SECRET_VALUE_SENTINEL';
    let defaults = 0;
    const field = secret(env(z.string(), 'TOKEN'))
      .describe(sentinel)
      .meta({ examples: [sentinel] })
      .default(() => {
        defaults += 1;
        return sentinel;
      });
    const result = deriveConfigSecretFields(z.object({ token: field }));
    expect(result).toEqual({
      complete: true,
      fields: [
        {
          ancestors: [],
          env: 'TOKEN',
          path: 'token',
          required: false,
          secret: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(defaults).toBe(0);
  });

  test('sorts output paths regardless of authored field order', () => {
    const a = secret(env(z.string(), 'A'));
    const b = secret(env(z.string(), 'B'));
    expect(
      deriveConfigSecretFields(
        z.object(
          Object.fromEntries([
            ['b', b],
            ['a', a],
          ])
        )
      )
    ).toEqual(deriveConfigSecretFields(z.object({ a, b })));
  });

  test('rejects annotated or coercing array elements', () => {
    for (const element of [
      env(z.string(), 'ITEM'),
      deprecated(z.string(), 'use other'),
      z.coerce.string(),
    ]) {
      expect(
        deriveConfigSecretFields(z.object({ items: z.array(element) }))
      ).toEqual({
        complete: false,
        path: 'items',
        reason: 'unsupported-schema',
      });
    }
  });

  test('rejects root and nested object getters without evaluating them', () => {
    let calls = 0;
    const schema = z.object({
      get token() {
        calls += 1;
        return secret(env(z.string(), 'TOKEN'));
      },
    });
    expect(deriveConfigSecretFields(schema)).toEqual({
      complete: false,
      path: '',
      reason: 'unsupported-schema',
    });
    expect(deriveConfigSecretFields(z.object({ nested: schema }))).toEqual({
      complete: false,
      path: 'nested',
      reason: 'unsupported-schema',
    });
    expect(calls).toBe(0);
  });

  test('rejects discriminator getters without evaluating them', () => {
    let calls = 0;
    const schema = z.discriminatedUnion('kind', [
      z.object({
        get kind() {
          calls += 1;
          return z.literal('key');
        },
      }),
      z.object({ kind: z.literal('none') }),
    ]);
    const before = calls;
    expect(
      deriveConfigSecretFields(schema, { discriminants: { kind: 'none' } })
    ).toEqual({ complete: false, path: 'kind', reason: 'unsupported-schema' });
    expect(calls).toBe(before);
  });

  test('does not inspect getters in an unselected branch', () => {
    let calls = 0;
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('none') }),
      z.object({
        kind: z.literal('key'),
        get token() {
          calls += 1;
          return secret(z.string());
        },
      }),
    ]);
    expect(
      deriveConfigSecretFields(schema, { discriminants: { kind: 'none' } })
    ).toEqual({ complete: true, fields: [] });
    expect(calls).toBe(0);
  });

  test('imports and fails closed when descriptor-safe object inspection is unavailable', () => {
    const moduleUrl = new URL('../secret-fields.ts', import.meta.url).href;
    const result = Bun.spawnSync(
      [
        process.execPath,
        '--eval',
        `import {mock} from 'bun:test';
       import {z} from 'zod';
       const core = await import('zod/v4/core');
       const exports = {...core, util:{...core.util, rawShape:undefined}};
       mock.module('zod/v4/core', () => exports);
       const {deriveConfigSecretFields} = await import(${JSON.stringify(moduleUrl)});
       let calls = 0;
       const schema = z.object({get token(){calls++;return z.string();}});
       const projected = deriveConfigSecretFields(schema);
       console.log(JSON.stringify({projected,calls}));`,
      ],
      { cwd: import.meta.dir }
    );
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      calls: 0,
      projected: { complete: false, path: '', reason: 'unsupported-schema' },
    });
  });
});
