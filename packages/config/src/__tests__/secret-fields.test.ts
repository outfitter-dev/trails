import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { globalRegistry, z } from 'zod';

import { deriveConfigSecretFields } from '../index.js';
import { deprecated, env, secret } from '../extensions.js';

describe('deriveConfigSecretFields', () => {
  describe('declared presence and nested paths', () => {
    test('derives only explicitly sensitive fields and local requiredness', () => {
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
              {
                defaulted: true,
                nullable: true,
                optional: true,
                path: 'nested',
              },
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

    test('matches optional JWT-secret metadata for a declared branch', () => {
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
  });

  describe('explicit branch selection', () => {
    test('selects by the declared literal without validating a refinement', () => {
      let calls = 0;
      const schema = z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('key').refine(() => {
            calls += 1;
            return false;
          }),
          token: secret(z.string()),
        }),
        z.object({ kind: z.literal('none') }),
      ]);
      expect(
        deriveConfigSecretFields(schema, { discriminants: { kind: 'key' } })
      ).toMatchObject({ complete: true, fields: [{ path: 'token' }] });
      expect(calls).toBe(0);
      expect(schema.safeParse({ kind: 'key', token: 'input' }).success).toBe(
        false
      );
      expect(calls).toBe(1);
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
      expect(
        deriveConfigSecretFields(z.union([z.string(), z.number()]))
      ).toEqual({ complete: false, path: '', reason: 'unsupported-schema' });
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

    test('rejects overwrites on fields, wrappers, arrays and discriminators without executing them', () => {
      let calls = 0;
      const overwrite = <T>(value: T): T => {
        calls += 1;
        return value;
      };
      for (const token of [
        secret(z.string().overwrite(overwrite)),
        z.string().trim(),
        z.object({ nested: z.string() }).overwrite(overwrite),
        z.string().optional().overwrite(overwrite),
        z.array(z.string()).overwrite(overwrite),
        z.array(z.string().overwrite(overwrite)),
      ]) {
        expect(deriveConfigSecretFields(z.object({ token }))).toEqual({
          complete: false,
          path: 'token',
          reason: 'unsupported-schema',
        });
      }
      const auth = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('key'), token: secret(z.string()) }),
        z.object({ kind: z.literal('none').overwrite(overwrite) }),
      ]);
      expect(
        deriveConfigSecretFields(z.object({ auth }), {
          discriminants: { 'auth.kind': 'key' },
        })
      ).toEqual({
        complete: false,
        path: 'auth.kind',
        reason: 'unsupported-schema',
      });
      expect(calls).toBe(0);
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
      ).toEqual({
        complete: false,
        path: 'kind',
        reason: 'unsupported-schema',
      });
      expect(
        deriveConfigSecretFields(z.object({ 'a.b': secret(z.string()) }))
      ).toEqual({ complete: false, path: '', reason: 'unsupported-schema' });
      expect(deriveConfigSecretFields(secret(z.literal(1n)))).toEqual({
        complete: false,
        path: '',
        reason: 'unsupported-schema',
      });
    });

    test('rejects object keys Zod can drop, including selector ancestors', () => {
      const selector = z.discriminatedUnion('__proto__', [
        z.object({ ['__proto__']: z.literal('none') }),
        z.object({
          ['__proto__']: z.literal('key'),
          token: secret(z.string()),
        }),
      ]);
      expect(
        deriveConfigSecretFields(selector, {
          discriminants: { ['__proto__']: 'none' },
        })
      ).toEqual({ complete: false, path: '', reason: 'unsupported-schema' });
      expect(selector.parse({ ['__proto__']: 'none' })).toEqual({});

      const nested = z.object({
        ['__proto__']: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('none') }),
          z.object({ kind: z.literal('key'), token: secret(z.string()) }),
        ]),
      });
      expect(
        deriveConfigSecretFields(nested, {
          discriminants: { '__proto__.kind': 'key' },
        })
      ).toEqual({ complete: false, path: '', reason: 'unsupported-schema' });
      expect(
        nested.parse({ ['__proto__']: { kind: 'key', token: 'input' } })
      ).toEqual({});
    });

    test('rejects overlapping discriminator claims even outside the selected branch', () => {
      const selected = z.object({ kind: z.literal('selected') });
      const cases = [
        z.discriminatedUnion('kind', [
          selected,
          z.object({ kind: z.literal(['one', 'duplicate']) }),
          z.object({ kind: z.literal(['two', 'duplicate']) }),
        ]),
        z.discriminatedUnion('kind', [
          selected,
          z.object({ kind: z.literal('other').nullable() }),
          z.object({ kind: z.literal(null) }),
        ]),
        z.discriminatedUnion('kind', [
          selected,
          z
            .object({ kind: z.literal('wrapped') })
            .optional() as unknown as typeof selected,
        ]),
      ];
      for (const schema of cases) {
        expect(
          deriveConfigSecretFields(schema, {
            discriminants: { kind: 'selected' },
          })
        ).toEqual({
          complete: false,
          path: 'kind',
          reason: 'unsupported-schema',
        });
      }
    });

    test('rejects custom branch option arrays without reading getters or iterators', () => {
      const branch = z.object({ kind: z.literal('selected') });
      const options = [branch];
      const schema = z.discriminatedUnion('kind', options);
      let reads = 0;
      const getBranch = () => {
        reads += 1;
        return branch;
      };
      const derive = () =>
        deriveConfigSecretFields(schema, {
          discriminants: { kind: 'selected' },
        });
      const unsupported = {
        complete: false,
        path: 'kind',
        reason: 'unsupported-schema',
      };
      Object.defineProperty(options, Symbol.iterator, {
        configurable: true,
        value() {
          return [getBranch()][Symbol.iterator]();
        },
      });
      expect(derive()).toEqual(unsupported);
      Reflect.deleteProperty(options, Symbol.iterator);
      Object.defineProperty(options, '0', { get: getBranch });
      expect(derive()).toEqual(unsupported);
      expect(reads).toBe(0);
    });

    test('fails closed when union and selected branch both declare metadata at one path', () => {
      const other = z.object({ kind: z.literal('other') });
      const branch = secret(
        env(z.object({ kind: z.literal('selected') }), 'BRANCH')
      );
      const schema = z.discriminatedUnion('kind', [other, branch]);
      const options = { discriminants: { 'auth.kind': 'selected' } };
      for (const auth of [env(schema, 'UNION'), secret(env(schema, 'UNION'))]) {
        expect(deriveConfigSecretFields(z.object({ auth }), options)).toEqual({
          complete: false,
          path: 'auth',
          reason: 'unsupported-schema',
        });
      }
      expect(
        deriveConfigSecretFields(z.object({ auth: schema }), options)
      ).toEqual({
        complete: true,
        fields: [
          {
            ancestors: [],
            env: 'BRANCH',
            path: 'auth',
            required: true,
            secret: true,
          },
        ],
      });
      expect(
        deriveConfigSecretFields(
          z.object({ auth: secret(env(schema, 'UNION')) }),
          {
            discriminants: { 'auth.kind': 'other' },
          }
        )
      ).toEqual({
        complete: true,
        fields: [
          {
            ancestors: [],
            env: 'UNION',
            path: 'auth',
            required: true,
            secret: true,
          },
        ],
      });
    });

    test('preserves same-path union wrappers for branch metadata and descendants', () => {
      const selected = secret(
        env(
          z.object({ kind: z.literal('key'), token: secret(z.string()) }),
          'AUTH'
        )
      );
      const union = z.discriminatedUnion('kind', [
        selected,
        z.object({ kind: z.literal('none') }),
      ]);
      let defaults = 0;
      for (const [auth, optional, defaulted, nullable] of [
        [union.optional(), true, false, false],
        [
          union.default(() => {
            defaults += 1;
            return { kind: 'none' };
          }),
          false,
          true,
          false,
        ],
        [union.nullable(), false, false, true],
      ] as const) {
        expect(
          deriveConfigSecretFields(z.object({ auth }), {
            discriminants: { 'auth.kind': 'key' },
          })
        ).toEqual({
          complete: true,
          fields: [
            {
              ancestors: [],
              env: 'AUTH',
              path: 'auth',
              required: !optional && !defaulted,
              secret: true,
            },
            {
              ancestors: [{ defaulted, nullable, optional, path: 'auth' }],
              path: 'auth.token',
              required: true,
              secret: true,
            },
          ],
        });
      }
      expect(defaults).toBe(0);
    });

    test('selects distinct multi-value and null literals without evaluating arrays', () => {
      const literals = ['key', 'other'] as const;
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal(literals), token: secret(z.string()) }),
        z.object({ kind: z.literal(null) }),
      ]);
      let calls = 0;
      Object.defineProperty(literals, '0', {
        get() {
          calls += 1;
          return 'key';
        },
      });
      const result = deriveConfigSecretFields(schema, {
        discriminants: { kind: 'key' },
      });
      expect(calls).toBe(0);
      expect(result).toEqual({
        complete: true,
        fields: [
          { ancestors: [], path: 'token', required: true, secret: true },
        ],
      });
      expect(
        deriveConfigSecretFields(schema, { discriminants: { kind: null } })
      ).toEqual({
        complete: true,
        fields: [],
      });
    });
  });

  describe('supported shapes and metadata', () => {
    test('fails closed when an intrinsic or attached format can rewrite a value', () => {
      const original = ' https://example.com ';
      const replacement = 'https://example.com/';
      const kind = z.literal(original).check(z.url({ normalize: true }));
      const auth = z.discriminatedUnion('kind', [
        z.object({ kind }),
        z.object({ kind: z.literal(replacement), token: secret(z.string()) }),
      ]);
      expect(
        deriveConfigSecretFields(auth, { discriminants: { kind: original } })
      ).toEqual({
        complete: false,
        path: 'kind',
        reason: 'unsupported-schema',
      });
      expect(kind.parse(original)).toBe(replacement);
      for (const token of [z.url(), z.string().url()]) {
        expect(deriveConfigSecretFields(z.object({ token }))).toEqual({
          complete: false,
          path: 'token',
          reason: 'unsupported-schema',
        });
        expect(token.parse(original)).toBe(original.trim());
      }
    });

    test('fails closed on refinements that can mutate selectors by reference', () => {
      let calls = 0;
      const none = z.object({ kind: z.literal('none') }).refine((value) => {
        calls += 1;
        Object.assign(value, { kind: 'key' });
        return true;
      });
      const key = z.object({
        kind: z.literal('key'),
        token: secret(z.string()),
      });
      const auth = z.discriminatedUnion('kind', [none, key]);
      const plain = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }),
        key,
      ]);
      const ancestor = z.object({ auth: plain }).refine((value) => {
        calls += 1;
        Object.assign(value.auth, { kind: 'key' });
        return true;
      });
      for (const schema of [
        auth,
        plain.refine(() => true),
        plain.optional().refine(() => true),
        ancestor,
      ]) {
        expect(
          deriveConfigSecretFields(schema, {
            discriminants: { 'auth.kind': 'none', kind: 'none' },
          })
        ).toEqual({ complete: false, path: '', reason: 'unsupported-schema' });
      }
      expect(calls).toBe(0);
      expect(auth.parse({ kind: 'none' })).toEqual({ kind: 'key' });
    });

    test('supports known validation-only formats, numeric and length checks', () => {
      const schema = z.object({
        email: secret(z.email()),
        list: secret(z.array(z.number().int().min(1)).min(1)),
        token: secret(
          z
            .string()
            .regex(/^token/)
            .min(2)
        ),
      });
      const result = deriveConfigSecretFields(schema);
      expect(result.complete && result.fields.map(({ path }) => path)).toEqual([
        'email',
        'list',
        'token',
      ]);
    });

    test('rejects payload-level checks while allowing ordinary validation', () => {
      let calls = 0;
      const kind = z.literal('none').check(
        z.check<string>((payload) => {
          calls += 1;
          payload.value = 'key';
        })
      );
      const auth = z.discriminatedUnion('kind', [
        z.object({ kind }),
        z.object({ kind: z.literal('key'), token: secret(z.string()) }),
      ]);
      expect(
        deriveConfigSecretFields(auth, { discriminants: { kind: 'none' } })
      ).toEqual({
        complete: false,
        path: 'kind',
        reason: 'unsupported-schema',
      });
      for (const token of [
        z.string().check((payload) => {
          calls += 1;
          payload.value = '';
        }),
        z.string().superRefine(() => {
          calls += 1;
        }),
        z.string().refine(() => true, {
          when(payload) {
            calls += 1;
            payload.value = '';
            return true;
          },
        }),
      ]) {
        expect(deriveConfigSecretFields(z.object({ token }))).toEqual({
          complete: false,
          path: 'token',
          reason: 'unsupported-schema',
        });
      }
      const token = secret(
        z
          .string()
          .min(1)
          .refine(() => {
            calls += 1;
            return true;
          })
      );
      expect(deriveConfigSecretFields(z.object({ token }))).toEqual({
        complete: true,
        fields: [
          { ancestors: [], path: 'token', required: true, secret: true },
        ],
      });
      expect(calls).toBe(0);
      expect(kind.parse('none')).toBe('key');
    });

    test('rejects every present catchall instead of omitting dynamic metadata', () => {
      for (const catchall of [
        secret(env(z.string(), 'DYNAMIC_SECRET')),
        z.object({ token: secret(z.string()) }),
        secret(z.unknown()),
        env(z.unknown(), 'DYNAMIC_UNKNOWN'),
        secret(z.never()),
        z.unknown(),
        z.never(),
      ]) {
        expect(
          deriveConfigSecretFields(z.object({}).catchall(catchall))
        ).toEqual({ complete: false, path: '', reason: 'unsupported-schema' });
      }
      expect(deriveConfigSecretFields(z.looseObject({}))).toEqual({
        complete: false,
        path: '',
        reason: 'unsupported-schema',
      });
      expect(deriveConfigSecretFields(z.strictObject({}))).toEqual({
        complete: false,
        path: '',
        reason: 'unsupported-schema',
      });
      expect(deriveConfigSecretFields(z.object({}).strip())).toEqual({
        complete: true,
        fields: [],
      });
    });

    test('reports the catchall container and inspects only the selected branch', () => {
      const dynamic = z.object({}).catchall(secret(z.string()));
      expect(deriveConfigSecretFields(z.object({ nested: dynamic }))).toEqual({
        complete: false,
        path: 'nested',
        reason: 'unsupported-schema',
      });
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }),
        z.object({ kind: z.literal('dynamic') }).catchall(secret(z.string())),
      ]);
      expect(
        deriveConfigSecretFields(schema, { discriminants: { kind: 'none' } })
      ).toEqual({ complete: true, fields: [] });
      expect(
        deriveConfigSecretFields(schema, { discriminants: { kind: 'dynamic' } })
      ).toEqual({ complete: false, path: '', reason: 'unsupported-schema' });
    });

    test('does not evaluate catchall accessors or defaults', () => {
      let effects = 0;
      const accessor = z.object({});
      Object.defineProperty(accessor.def, 'catchall', {
        get() {
          effects += 1;
          return secret(z.string());
        },
      });
      expect(deriveConfigSecretFields(accessor)).toEqual({
        complete: false,
        path: '',
        reason: 'unsupported-schema',
      });
      const withDefault = z.object({}).catchall(
        secret(z.string()).default(() => {
          effects += 1;
          return 'must-not-read';
        })
      );
      expect(deriveConfigSecretFields(withDefault)).toEqual({
        complete: false,
        path: '',
        reason: 'unsupported-schema',
      });
      expect(effects).toBe(0);
    });

    test('does not turn uninspected array elements into empty success', () => {
      expect(
        deriveConfigSecretFields(
          z.object({ keys: z.array(secret(env(z.string(), 'KEY'))) })
        )
      ).toEqual({
        complete: false,
        path: 'keys',
        reason: 'unsupported-schema',
      });
      expect(
        deriveConfigSecretFields(
          z.object({ rows: z.array(z.object({ token: secret(z.string()) })) })
        )
      ).toEqual({
        complete: false,
        path: 'rows',
        reason: 'unsupported-schema',
      });
      expect(
        deriveConfigSecretFields(
          z.object({ keys: z.array(env(secret(z.string()).optional(), 'KEY')) })
        )
      ).toEqual({
        complete: false,
        path: 'keys',
        reason: 'unsupported-schema',
      });
      expect(
        deriveConfigSecretFields(
          z.object({
            keys: secret(env(z.array(z.string()), 'KEYS')).optional(),
          })
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
  });

  describe('descriptor-safe inspection', () => {
    test('rejects nonstandard check arrays and inherited checks', () => {
      const schema = z.string().min(1);
      let iterators = 0;
      const rewrite = z.overwrite<string>(() => 'changed');
      const checks = [...(schema.def.checks ?? [])];
      Object.defineProperty(checks, Symbol.iterator, {
        *value() {
          iterators += 1;
          yield rewrite;
        },
      });
      const special = schema.clone({ ...schema.def, checks });
      const inherited: typeof schema.def = Object.assign(
        Object.create({ checks: [rewrite] }),
        { type: 'string' }
      );
      const subclass = schema.clone({
        ...schema.def,
        checks: Object.setPrototypeOf(
          [rewrite],
          Object.create(Array.prototype)
        ),
      });
      const before = iterators;
      for (const token of [special, schema.clone(inherited), subclass]) {
        expect(deriveConfigSecretFields(z.object({ token }))).toEqual({
          complete: false,
          path: 'token',
          reason: 'unsupported-schema',
        });
        expect(token.parse('token')).toBe('changed');
      }
      expect(iterators).toBe(before);
    });

    test('rejects check accessors without evaluating them', () => {
      let reads = 0;
      const schema = z.string().min(1);
      const { checks } = schema.def;
      Object.defineProperty(schema.def, 'checks', {
        get() {
          reads += 1;
          return checks;
        },
      });
      expect(deriveConfigSecretFields(z.object({ token: schema }))).toEqual({
        complete: false,
        path: 'token',
        reason: 'unsupported-schema',
      });
      expect(reads).toBe(0);
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
      ).toEqual({
        complete: false,
        path: 'kind',
        reason: 'unsupported-schema',
      });
      expect(calls).toBe(before);
    });

    test('rejects accessor-backed selections without reading them', () => {
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('key'), token: secret(z.string()) }),
        z.object({ kind: z.literal('none') }),
      ]);
      let calls = 0;
      const selections = {
        get kind(): 'key' {
          calls += 1;
          return 'key';
        },
      };
      const results = [
        deriveConfigSecretFields(schema, { discriminants: selections }),
        deriveConfigSecretFields(schema, {
          get discriminants() {
            calls += 1;
            return { kind: 'key' };
          },
        }),
      ];
      expect(calls).toBe(0);
      const incomplete = {
        complete: false,
        path: 'kind',
        reason: 'unsupported-schema',
      };
      expect(results).toEqual([incomplete, incomplete]);
    });

    test('rejects accessor-backed secret metadata through registry inheritance without reading it', () => {
      let calls = 0;
      const token = z.string();
      const clone = token.describe('token');
      globalRegistry.add(token, {
        get secret() {
          calls += 1;
          return true;
        },
      });
      const results = [token, clone].map((field) =>
        deriveConfigSecretFields(z.object({ token: field }))
      );
      expect(calls).toBe(0);
      expect(results).toEqual(
        Array.from({ length: 2 }, () => ({
          complete: false,
          path: 'token',
          reason: 'unsupported-schema',
        }))
      );
    });

    test('does not read excluded registry metadata', () => {
      let calls = 0;
      const token = z.string();
      const clone = token.describe('token');
      globalRegistry.add(token, {
        get deprecationMessage() {
          calls += 1;
          return 'unused';
        },
        secret: true,
      });
      const results = [token, clone].map((schema) =>
        deriveConfigSecretFields(schema)
      );
      expect(calls).toBe(0);
      const complete = {
        complete: true,
        fields: [{ ancestors: [], path: '', required: true, secret: true }],
      };
      expect(results).toEqual([complete, complete]);
    });

    test('fails closed for prototype-backed annotations without reading getters', () => {
      let calls = 0;
      const token = z.string();
      globalRegistry.add(
        token,
        Object.create({
          get secret() {
            calls += 1;
            return true;
          },
        })
      );
      expect(deriveConfigSecretFields(z.object({ token }))).toEqual({
        complete: false,
        path: 'token',
        reason: 'unsupported-schema',
      });
      expect(calls).toBe(0);
    });

    test('ignores non-enumerable object fields before and after Zod reads the shape', () => {
      let calls = 0;
      const shape = { visible: z.string() };
      Object.defineProperties(shape, {
        hidden: { value: secret(z.string()) },
        ignored: {
          get() {
            calls += 1;
            return secret(z.string());
          },
        },
      });
      const schema = z.object(shape);
      expect(deriveConfigSecretFields(schema)).toEqual({
        complete: true,
        fields: [],
      });
      void schema.shape;
      expect(deriveConfigSecretFields(schema)).toEqual({
        complete: true,
        fields: [],
      });
      expect(calls).toBe(0);
    });

    test('rejects cycles in materialized object shapes without rejecting shared schemas', () => {
      const recursive = z.object({
        get child(): z.ZodOptional<z.ZodType> {
          return recursive.optional();
        },
      });
      void recursive.shape;
      expect(deriveConfigSecretFields(recursive)).toEqual({
        complete: false,
        path: 'child',
        reason: 'unsupported-schema',
      });

      const shared = z.object({ token: secret(z.string()) });
      expect(
        deriveConfigSecretFields(z.object({ a: shared, b: shared }))
      ).toEqual({
        complete: true,
        fields: [
          { ancestors: [], path: 'a.token', required: true, secret: true },
          { ancestors: [], path: 'b.token', required: true, secret: true },
        ],
      });
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

    test('does not inspect annotations on an unselected branch object', () => {
      let calls = 0;
      const unselected = z.object({ kind: z.literal('key') });
      globalRegistry.add(unselected, {
        get secret() {
          calls += 1;
          return true;
        },
      });
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('none') }),
        unselected,
      ]);
      expect(
        deriveConfigSecretFields(schema, { discriminants: { kind: 'none' } })
      ).toEqual({
        complete: true,
        fields: [],
      });
      expect(
        deriveConfigSecretFields(schema, { discriminants: { kind: 'key' } })
      ).toEqual({
        complete: false,
        path: '',
        reason: 'unsupported-schema',
      });
      expect(calls).toBe(0);
    });
  });

  describe('Zod compatibility', () => {
    test('fails closed on length checks from the CommonJS Zod build', () => {
      const requireZod = createRequire(import.meta.url);
      const { z: commonJsZod } = requireZod('zod') as { z: typeof z };
      const esm = z.object({ token: secret(z.string().min(1)) });
      const mixed = commonJsZod.object({
        token: secret(commonJsZod.string().min(1)),
      });
      const plain = commonJsZod.object({ token: secret(commonJsZod.string()) });
      expect(mixed.safeParse({ token: 'input' }).success).toBe(true);
      expect(deriveConfigSecretFields(esm)).toMatchObject({
        complete: true,
        fields: [{ path: 'token' }],
      });
      expect(deriveConfigSecretFields(mixed)).toEqual({
        complete: false,
        path: 'token',
        reason: 'unsupported-schema',
      });
      expect(deriveConfigSecretFields(plain)).toMatchObject({
        complete: true,
        fields: [{ path: 'token' }],
      });
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
       const derived = deriveConfigSecretFields(schema);
       console.log(JSON.stringify({derived,calls}));`,
        ],
        { cwd: import.meta.dir }
      );
      expect(result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({
        calls: 0,
        derived: { complete: false, path: '', reason: 'unsupported-schema' },
      });
    });
  });
});
