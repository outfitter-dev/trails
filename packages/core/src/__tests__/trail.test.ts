import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { entity } from '../entity';
import { createTrailContext } from '../context';
import { ConflictError, ValidationError } from '../errors';
import { Result } from '../result';
import { resource } from '../resource';
import { schedule } from '../schedule';
import { signal } from '../signal';
import {
  deriveSupportedTrailVersions,
  getTrailVersionEntryKind,
  isArchivedTrailVersionEntry,
  isLiveTrailVersionEntry,
  intentValues,
  trail,
} from '../trail';
import type { TrailContext } from '../types';
import { webhook } from '../webhook';

const stubCtx: TrailContext = createTrailContext({
  abortSignal: AbortSignal.timeout(5000),
  requestId: 'test-123',
});

const dbResource = resource('db.main', {
  create: () =>
    Result.ok({
      query(sql: string) {
        return sql.length;
      },
    }),
  description: 'Primary database resource',
});

const userEntity = entity(
  'user',
  {
    id: z.string().uuid(),
    name: z.string(),
  },
  { identity: 'id' }
);

describe('trail()', () => {
  const inputSchema = z.object({ name: z.string() });
  const outputSchema = z.object({ greeting: z.string() });

  const greet = trail('greet', {
    description: 'Greet someone',
    implementation: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
    input: inputSchema,
    output: outputSchema,
  });

  describe('basics', () => {
    test('returns correct id', () => {
      expect(greet.id).toBe('greet');
    });

    test("returns kind 'trail'", () => {
      expect(greet.kind).toBe('trail');
    });

    test('preserves input schema', () => {
      const parsed = greet.input.safeParse({ name: 'World' });
      expect(parsed.success).toBe(true);

      const bad = greet.input.safeParse({ name: 42 });
      expect(bad.success).toBe(false);
    });

    test('output schema is optional', () => {
      const minimal = trail('noop', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.output).toBeUndefined();
    });

    test('implementation is callable', async () => {
      const result = await greet.implementation({ name: 'World' }, stubCtx);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ greeting: 'Hello, World!' });
    });

    test('rejects the retired contours collection instead of preserving it', () => {
      const retiredSpec = {
        contours: [userEntity],
        implementation: () => Result.ok(),
        input: z.object({}),
      };

      expect(() => trail('legacy.contours', retiredSpec)).toThrow(
        'uses retired "contours"; use "entities" instead'
      );
    });
  });

  describe('versioning', () => {
    test('keeps unversioned trails current-only', () => {
      const unversioned = trail('plain.current', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
      });

      expect(unversioned.version).toBeUndefined();
      expect(unversioned.versions).toBeUndefined();
      expect(deriveSupportedTrailVersions(unversioned)).toEqual([]);
    });

    test('stores revision entries and derives live support', () => {
      const v2Input = z.object({ name: z.string() });
      const v2Output = z.object({ greeting: z.string() });
      const v2Examples = [
        {
          expected: { greeting: 'Hello, Ada!' },
          input: { name: 'Ada' },
          name: 'Legacy greeting',
        },
      ];
      const versioned = trail('invite.create', {
        implementation: (input) =>
          Result.ok({ greeting: `Hello, ${input.name}!` }),
        input: inputSchema,
        output: outputSchema,
        version: 3,
        versions: {
          2: {
            examples: v2Examples,
            input: v2Input,
            output: v2Output,
            status: { state: 'deprecated', successor: 3 },
            transpose: {
              input: ({ input }) => input,
              output: ({ output }) => output,
            },
          },
        },
      });

      const entry = versioned.versions?.[2];
      expect(versioned.version).toBe(3);
      expect(Object.isFrozen(versioned.versions)).toBe(true);
      expect(entry?.input).toBe(v2Input);
      expect(entry?.output).toBe(v2Output);
      expect(entry?.examples).toEqual(v2Examples);
      expect(Object.isFrozen(entry?.examples)).toBe(true);
      expect(entry?.status).toEqual({ state: 'deprecated', successor: 3 });
      expect(entry && getTrailVersionEntryKind(entry)).toBe('revision');
      expect(deriveSupportedTrailVersions(versioned)).toEqual([2, 3]);
    });

    test('allows metadata-only revision entries for unchanged schemas', () => {
      const versioned = trail('metadata.revision', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({ id: z.string() }),
        output: z.object({ ok: z.boolean() }),
        version: 2,
        versions: {
          1: {
            input: z.object({ id: z.string() }),
            output: z.object({ ok: z.boolean() }),
          },
        },
      });

      const entry = versioned.versions?.[1];
      expect(entry && getTrailVersionEntryKind(entry)).toBe('revision');
      expect('transpose' in (entry as Record<string, unknown>)).toBe(false);
    });

    test('allows metadata-only revisions when equivalent schema arrays differ in order', () => {
      const versioned = trail('metadata.reordered-schema', {
        implementation: (input) => Result.ok({ state: input.state }),
        input: z.object({
          id: z.string(),
          state: z.enum(['queued', 'sent']),
        }),
        output: z.object({
          state: z.enum(['queued', 'sent']),
        }),
        version: 2,
        versions: {
          1: {
            input: z.object({
              id: z.string(),
              state: z.enum(['sent', 'queued']),
            }),
            output: z.object({
              state: z.enum(['sent', 'queued']),
            }),
          },
        },
      });

      const entry = versioned.versions?.[1];
      expect(entry && getTrailVersionEntryKind(entry)).toBe('revision');
      expect('transpose' in (entry as Record<string, unknown>)).toBe(false);
    });

    test('allows metadata-only revisions when current output schema is absent', () => {
      const versioned = trail('metadata.no-current-output', {
        implementation: () => Result.ok(),
        input: z.object({ id: z.string() }),
        version: 2,
        versions: {
          1: {
            input: z.object({ id: z.string() }),
            output: z.void(),
          },
        },
      });

      const entry = versioned.versions?.[1];
      expect(entry && getTrailVersionEntryKind(entry)).toBe('revision');
      expect('transpose' in (entry as Record<string, unknown>)).toBe(false);
    });

    test('rejects schema-changing revision entries without transpose', () => {
      expect(() =>
        trail('missing.input.transpose', {
          implementation: (input) => Result.ok({ id: input.id }),
          input: z.object({ id: z.string(), requiredNow: z.string() }),
          output: z.object({ id: z.string() }),
          version: 2,
          versions: {
            1: {
              input: z.object({ id: z.string() }),
              output: z.object({ id: z.string() }),
            },
          },
        })
      ).toThrow(ValidationError);

      expect(() =>
        trail('missing.output.transpose', {
          implementation: () => Result.ok({ state: 'queued' as const }),
          input: z.object({}),
          output: z.object({ state: z.enum(['queued', 'sent']) }),
          version: 2,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ state: z.literal('sent') }),
            },
          },
        })
      ).toThrow(ValidationError);
    });

    test('stores fork entries with normalized runtime references', () => {
      const target = trail('target.read', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
      });
      const versioned = trail('forked.run', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        version: 2,
        versions: {
          1: {
            composes: [target],
            detours: [
              {
                on: ConflictError,
                recover: async () => Result.ok({ ok: true }),
              },
            ],
            implementation: () => Result.ok({ ok: true }),
            input: z.object({}),
            output: z.object({ ok: z.boolean() }),
            resources: [dbResource],
          },
        },
      });

      const entry = versioned.versions?.[1] as
        | (Record<string, unknown> & { composes: readonly string[] })
        | undefined;
      expect(entry && getTrailVersionEntryKind(entry)).toBe('fork');
      expect(entry?.composes).toEqual(['target.read']);
      expect(entry?.resources).toEqual([dbResource]);
      expect(entry?.detours).toHaveLength(1);
      expect(Object.isFrozen(entry?.composes)).toBe(true);
    });

    test('allows version gaps and excludes archived entries from support', () => {
      const versioned = trail('gap.versioned', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        version: 5,
        versions: {
          2: {
            input: z.object({}),
            output: z.object({ ok: z.boolean() }),
          },
          3: {
            input: z.object({}),
            output: z.object({ ok: z.boolean() }),
            status: { state: 'deprecated', successor: 5 },
          },
          4: {
            input: z.object({}),
            output: z.object({ ok: z.boolean() }),
            status: { reason: 'No callers remain.', state: 'archived' },
          },
        },
      });

      expect(Object.keys(versioned.versions ?? {})).toEqual(['2', '3', '4']);
      expect(deriveSupportedTrailVersions(versioned)).toEqual([2, 3, 5]);
      const archivedEntry = versioned.versions?.[4];
      const deprecatedEntry = versioned.versions?.[3];
      const liveEntry = versioned.versions?.[2];
      expect(archivedEntry).toBeDefined();
      expect(deprecatedEntry).toBeDefined();
      expect(liveEntry).toBeDefined();
      if (
        archivedEntry === undefined ||
        deprecatedEntry === undefined ||
        liveEntry === undefined
      ) {
        throw new Error('expected versioned entries to be normalized');
      }
      expect(isArchivedTrailVersionEntry(archivedEntry)).toBe(true);
      expect(isLiveTrailVersionEntry(archivedEntry)).toBe(false);
      expect(isLiveTrailVersionEntry(deprecatedEntry)).toBe(true);
      expect(isLiveTrailVersionEntry(liveEntry)).toBe(true);
    });

    test('rejects invalid version entry shapes', () => {
      const base = {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        version: 2,
      };

      expect(() =>
        trail('bad.mixed', {
          ...base,
          versions: {
            1: {
              implementation: () => Result.ok({ ok: true }),
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              transpose: {
                input: ({ input }: { input: unknown }) => input,
                output: ({ output }: { output: unknown }) => output,
              },
            } as never,
          },
        })
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.missing-output', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
            } as never,
          },
        })
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.revision-runtime-fields', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              resources: [dbResource],
            } as never,
          },
        })
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.revision-compose-input', {
          ...base,
          versions: {
            1: {
              composeInput: z.object({ caller: z.string() }),
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
            } as never,
          },
        })
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.kind', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              kind: 'revision',
              output: z.object({ ok: z.boolean() }),
            } as never,
          },
        })
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.marker', {
          ...base,
          marker: 'abcd000000000000',
        } as never)
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.version-marker', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              marker: 'abcd000000000000',
              output: z.object({ ok: z.boolean() }),
            } as never,
          },
        })
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.current-duplicate', {
          ...base,
          versions: {
            2: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
            },
          },
        })
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.future-history', {
          ...base,
          versions: {
            3: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
            },
          },
        })
      ).toThrow('must be less than the current version');

      expect(() =>
        trail('bad.version-examples', {
          ...base,
          versions: {
            1: {
              examples: { input: {}, name: 'not an array' },
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
            } as never,
          },
        })
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.no-current', {
          implementation: () => Result.ok({ ok: true }),
          input: z.object({}),
          output: z.object({ ok: z.boolean() }),
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
            },
          },
        } as never)
      ).toThrow(ValidationError);

      expect(() =>
        trail('bad.deprecated-without-guidance', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: { state: 'deprecated' },
            } as never,
          },
        })
      ).toThrow('must declare successor, migration, or note guidance');

      expect(() =>
        trail('bad.deprecated-migration', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: { migration: 'Use v2.', state: 'deprecated' },
            } as never,
          },
        })
      ).toThrow('status.migration must be an array');

      expect(() =>
        trail('bad.deprecated-migration-item', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: { migration: ['Use v2.', 2], state: 'deprecated' },
            } as never,
          },
        })
      ).toThrow('status.migration[1] must be a non-empty string');

      expect(() =>
        trail('bad.deprecated-migration-blank', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: { migration: ['   '], state: 'deprecated' },
            },
          },
        })
      ).toThrow('status.migration[0] must be a non-empty string');

      expect(() =>
        trail('bad.deprecated-note', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: {
                migration: ['Use v2.'],
                note: 42,
                state: 'deprecated',
              },
            } as never,
          },
        })
      ).toThrow('status.note must be a string');

      expect(() =>
        trail('bad.deprecated-blank-note', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: { note: '   ', state: 'deprecated' },
            },
          },
        })
      ).toThrow('status.note must be a non-empty string');

      expect(() =>
        trail('bad.deprecated-successor', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: { state: 'deprecated', successor: 999 },
            },
          },
        })
      ).toThrow(
        'status.successor must reference the current version or another known historical version'
      );

      expect(() =>
        trail('bad.deprecated-self-successor', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: { state: 'deprecated', successor: 1 },
            },
          },
        })
      ).toThrow(
        'status.successor must reference the current version or another known historical version'
      );

      expect(() =>
        trail('bad.archived-reason', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: { reason: 42, state: 'archived' },
            } as never,
          },
        })
      ).toThrow('status.reason must be a non-empty string');

      expect(() =>
        trail('bad.archived-blank-reason', {
          ...base,
          versions: {
            1: {
              input: z.object({}),
              output: z.object({ ok: z.boolean() }),
              status: { reason: '   ', state: 'archived' },
            },
          },
        })
      ).toThrow('status.reason must be a non-empty string');
    });
  });

  describe('meta', () => {
    test('examples are stored', () => {
      const withExamples = trail('echo', {
        examples: [
          { error: 'ValidationError', input: { text: '' }, name: 'error-case' },
          { expected: { text: 'hi' }, input: { text: 'hi' }, name: 'basic' },
        ],
        implementation: (input) => Result.ok({ text: input.text }),
        input: z.object({ text: z.string() }),
      });
      expect(withExamples.examples).toHaveLength(2);
      const first = withExamples.examples?.[0];
      expect(first?.name).toBe('error-case');
      const second = withExamples.examples?.[1];
      expect(second?.name).toBe('basic');
    });

    test('meta is stored', () => {
      const withMeta = trail('tagged', {
        implementation: () => Result.ok(),
        input: z.object({}),
        meta: { domain: 'billing', tier: 1 },
      });
      expect(withMeta.meta).toEqual({ domain: 'billing', tier: 1 });
    });

    test('pattern is stored when declared', () => {
      const withPattern = trail('feature.enable', {
        implementation: () => Result.ok({ enabled: true }),
        input: z.object({ id: z.string() }),
        pattern: 'toggle',
      });

      expect(withPattern.pattern).toBe('toggle');
    });

    test('detours are stored', () => {
      const withDetours = trail('orchestrator', {
        /* oxlint-disable-next-line require-await -- test stub */
        detours: [{ on: ConflictError, recover: async () => Result.ok() }],
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(withDetours.detours).toHaveLength(1);
      expect(withDetours.detours[0]?.on).toBe(ConflictError);
    });

    test('detours default to empty frozen array when omitted', () => {
      const noDetours = trail('bare', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(noDetours.detours).toEqual([]);
      expect(Object.isFrozen(noDetours.detours)).toBe(true);
    });
  });

  describe('composes', () => {
    test('defaults to empty frozen array when omitted', () => {
      const minimal = trail('bare', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.composes).toEqual([]);
      expect(Object.isFrozen(minimal.composes)).toBe(true);
    });

    test('preserves composes array', () => {
      const withComposes = trail('composed', {
        composes: ['authenticate', 'validate-session'],
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(withComposes.composes).toEqual([
        'authenticate',
        'validate-session',
      ]);
    });

    test('composes array is frozen', () => {
      const withComposes = trail('composed', {
        composes: ['authenticate'],
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(Object.isFrozen(withComposes.composes)).toBe(true);
    });

    test('trail object in composes is normalized to its id', () => {
      const target = trail('target.trail', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      const composed = trail('composed', {
        composes: [target],
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(composed.composes).toEqual(['target.trail']);
    });

    test('mixed string and trail object in composes normalizes correctly', () => {
      const target = trail('target.trail', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      const composed = trail('composed', {
        composes: ['string-id', target],
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(composed.composes).toEqual(['string-id', 'target.trail']);
    });

    test('composeInput is stored on the trail', () => {
      const composeInputSchema = z.object({
        forkedFrom: z.string().optional(),
      });
      const t = trail('gist.create', {
        composeInput: composeInputSchema,
        implementation: () => Result.ok(),
        input: z.object({ content: z.string() }),
      });
      expect(t.composeInput).toBe(composeInputSchema);
    });

    test('composeInput is undefined when omitted', () => {
      const t = trail('bare', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(t.composeInput).toBeUndefined();
    });
  });

  describe('entities', () => {
    test('defaults to empty frozen array when omitted', () => {
      const minimal = trail('bare', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.entities).toEqual([]);
      expect(Object.isFrozen(minimal.entities)).toBe(true);
    });

    test('preserves declared entity objects', () => {
      const withEntities = trail('user.create', {
        entities: [userEntity],
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(withEntities.entities).toEqual([userEntity]);
      expect(withEntities.entities[0]).toBe(userEntity);
    });

    test('entities array is frozen', () => {
      const withEntities = trail('user.create', {
        entities: [userEntity],
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(Object.isFrozen(withEntities.entities)).toBe(true);
    });
  });

  describe('resources', () => {
    test('defaults to empty frozen array when omitted', () => {
      const minimal = trail('bare', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.resources).toEqual([]);
      expect(Object.isFrozen(minimal.resources)).toBe(true);
    });

    test('preserves declared resource objects', () => {
      const withResources = trail('search', {
        implementation: () => Result.ok(),
        input: z.object({}),
        resources: [dbResource],
      });
      expect(withResources.resources).toEqual([dbResource]);
      expect(withResources.resources[0]).toBe(dbResource);
    });

    test('resources array is frozen', () => {
      const withResources = trail('search', {
        implementation: () => Result.ok(),
        input: z.object({}),
        resources: [dbResource],
      });
      expect(Object.isFrozen(withResources.resources)).toBe(true);
    });
  });

  describe('intent and idempotent', () => {
    test('intentValues is the owner-held runtime vocabulary', () => {
      expect(intentValues).toEqual(['read', 'write', 'destroy']);
      expect(Object.isFrozen(intentValues)).toBe(true);
    });

    test('intent defaults to write', () => {
      const minimal = trail('bare', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.intent).toBe('write');
      expect(minimal.idempotent).toBeUndefined();
    });

    test('intent is preserved when set', () => {
      const readTrail = trail('reader', {
        implementation: () => Result.ok(),
        input: z.object({}),
        intent: 'read',
      });
      expect(readTrail.intent).toBe('read');

      const destroyTrail = trail('destroyer', {
        implementation: () => Result.ok(),
        input: z.object({}),
        intent: 'destroy',
      });
      expect(destroyTrail.intent).toBe('destroy');
    });

    test('idempotent is preserved when set', () => {
      const t = trail('idempotent', {
        idempotent: true,
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(t.idempotent).toBe(true);
    });

    test('dryRun capability is preserved when set', () => {
      const t = trail('supports.dry-run', {
        dryRun: true,
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(t.dryRun).toBe(true);
    });

    test('visibility defaults to public', () => {
      const minimal = trail('visible', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.visibility).toBe('public');
    });

    test('visibility is preserved when set', () => {
      const t = trail('internal.helper', {
        implementation: () => Result.ok(),
        input: z.object({}),
        visibility: 'internal',
      });
      expect(t.visibility).toBe('internal');
    });
  });

  describe('single-object overload', () => {
    test('accepts spec with id property', () => {
      const t = trail({
        id: 'entity.show',
        implementation: (input: { name: string }, _ctx: TrailContext) =>
          Result.ok({ greeting: `Hi, ${input.name}` }),
        input: inputSchema,
      });
      expect(t.id).toBe('entity.show');
      expect(t.kind).toBe('trail');
    });

    test('preserves all spec fields', () => {
      const t = trail({
        description: 'A full trail',
        examples: [{ input: { name: 'World' }, name: 'test' }],
        id: 'full',
        implementation: (input: { name: string }, _ctx: TrailContext) =>
          Result.ok({ greeting: `Hi, ${input.name}` }),
        input: inputSchema,
        intent: 'read',
        output: outputSchema,
        resources: [dbResource],
      });
      expect(t.description).toBe('A full trail');
      expect(t.intent).toBe('read');
      expect(t.examples).toHaveLength(1);
      expect(t.resources).toEqual([dbResource]);
    });

    test('implementation is callable', async () => {
      const t = trail({
        id: 'callable',
        implementation: (input: { x: number }) => Result.ok(input.x * 2),
        input: z.object({ x: z.number() }),
      });
      const result = await t.implementation({ x: 5 }, stubCtx);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(10);
    });

    test('sync implementations are normalized to an awaitable runtime function', async () => {
      const t = trail('normalized', {
        implementation: (input: { value: number }) =>
          Result.ok(input.value + 1),
        input: z.object({ value: z.number() }),
      });

      const promise = t.implementation({ value: 2 }, stubCtx);
      expect(promise).toBeInstanceOf(Promise);

      const result = await promise;
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(3);
    });
  });
});

describe('trail() fires/on normalization', () => {
  const orderPlaced = signal('order.placed', {
    payload: z.object({ id: z.string() }),
  });
  const auditLogged = signal('audit.logged', {
    payload: z.object({ actor: z.string() }),
  });

  test('Signal value in fires: is normalized to its id', () => {
    const t = trail('checkout', {
      fires: [orderPlaced],
      implementation: () => Result.ok({}),
      input: z.object({}),
    });
    expect(t.fires).toEqual(['order.placed']);
  });

  test('Signal value in on: is normalized to its id', () => {
    const t = trail('notify', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      on: [orderPlaced],
    });
    expect(t.on).toEqual(['order.placed']);
    expect(t.activationSources).toEqual([
      { source: { id: 'order.placed', kind: 'signal' } },
    ]);
  });

  test('object-form on: source normalizes to the same activation graph', () => {
    const bare = trail('notify.bare', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      on: [orderPlaced],
    });
    const objectForm = trail('notify.object', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      on: [{ source: orderPlaced }],
    });

    expect(objectForm.on).toEqual(bare.on);
    expect(objectForm.activationSources).toEqual(bare.activationSources);
    expect(Object.isFrozen(objectForm.activationSources)).toBe(true);
    expect(Object.isFrozen(objectForm.activationSources[0])).toBe(true);
    expect(Object.isFrozen(objectForm.activationSources[0]?.source)).toBe(true);
  });

  test('object-form signal activation source preserves source metadata', () => {
    const t = trail('notify.object-source', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      on: [
        {
          source: {
            id: 'order.placed',
            input: { channel: 'orders' },
            kind: 'signal',
            meta: { owner: 'checkout' },
          },
        },
      ],
    });

    expect(t.activationSources).toEqual([
      {
        source: {
          id: 'order.placed',
          input: { channel: 'orders' },
          kind: 'signal',
          meta: { owner: 'checkout' },
        },
      },
    ]);
    expect(Object.isFrozen(t.activationSources[0]?.source.meta)).toBe(true);
  });

  test('schedule and webhook source objects stay inert and normalized', () => {
    const scheduleSource = schedule('schedule.nightly-close', {
      cron: '0 2 * * *',
      input: { olderThanDays: 90 },
      timezone: 'UTC',
    });
    const webhookSource = webhook('webhook.stripe.payment', {
      meta: { provider: 'stripe' },
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/stripe/payment',
    });

    const t = trail('billing.reconcile', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      on: [
        scheduleSource,
        { meta: { owner: 'billing' }, source: webhookSource },
      ],
    });

    expect(t.on).toEqual([]);
    expect(t.activationSources).toEqual([
      { source: scheduleSource },
      {
        meta: { owner: 'billing' },
        source: webhookSource,
      },
    ]);
    expect(Object.isFrozen(webhookSource.meta)).toBe(true);
  });

  test('mixed string + Signal value in fires: is normalized', () => {
    const t = trail('checkout', {
      fires: ['metric.emitted', orderPlaced, auditLogged],
      implementation: () => Result.ok({}),
      input: z.object({}),
    });
    expect(t.fires).toEqual(['metric.emitted', 'order.placed', 'audit.logged']);
  });

  test('defaults to empty frozen arrays when omitted', () => {
    const minimal = trail('bare', {
      implementation: () => Result.ok(),
      input: z.object({}),
    });
    expect(minimal.fires).toEqual([]);
    expect(Object.isFrozen(minimal.fires)).toBe(true);
    expect(minimal.on).toEqual([]);
    expect(Object.isFrozen(minimal.on)).toBe(true);
    expect(minimal.activationSources).toEqual([]);
    expect(Object.isFrozen(minimal.activationSources)).toBe(true);
  });
});
