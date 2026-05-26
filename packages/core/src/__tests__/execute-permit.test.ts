import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { PermitError } from '../errors';
import { executeTrail } from '../execute';
import type { Layer } from '../layer';
import { Result } from '../result';
import { resource } from '../resource';
import { topo } from '../topo';
import { trail } from '../trail';

const protectedTrail = trail('permit.protected', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  permit: { scopes: ['entity:write'] },
});

describe('executeTrail permit enforcement', () => {
  test('runs scoped trails when the context permit has all required scopes', async () => {
    const result = await executeTrail(
      protectedTrail,
      {},
      {
        ctx: {
          permit: { id: 'permit-1', scopes: ['entity:read', 'entity:write'] },
        },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ ok: true });
  });

  test('rejects scoped trails when no permit is available', async () => {
    let ran = false;
    const t = trail('permit.missing', {
      blaze: () => {
        ran = true;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['entity:write'] },
    });

    const result = await executeTrail(t, {});

    expect(result.isErr()).toBe(true);
    expect(result.error).toBeInstanceOf(PermitError);
    expect(result.error.message).toContain('No permit');
    expect(ran).toBe(false);
  });

  test('rejects scoped trails when required scopes are missing', async () => {
    const result = await executeTrail(
      protectedTrail,
      {},
      {
        ctx: { permit: { id: 'permit-1', scopes: ['entity:read'] } },
      }
    );

    expect(result.isErr()).toBe(true);
    expect(result.error).toBeInstanceOf(PermitError);
    expect(result.error.message).toContain('entity:write');
    expect(result.error.context).toEqual({
      missing: ['entity:write'],
      required: ['entity:write'],
      trailId: 'permit.protected',
    });
  });

  test('allows public and undeclared trails without a permit', async () => {
    const publicTrail = trail('permit.public', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permit: 'public',
    });
    const undeclaredTrail = trail('permit.undeclared', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });

    const publicResult = await executeTrail(publicTrail, {});
    const undeclaredResult = await executeTrail(undeclaredTrail, {});

    expect(publicResult.isOk()).toBe(true);
    expect(undeclaredResult.isOk()).toBe(true);
  });

  test('rejects before resource creation and layer composition', async () => {
    let created = false;
    let wrapped = false;
    const protectedResource = resource('permit.protected.resource', {
      create: () => {
        created = true;
        return Result.ok({ ok: true });
      },
    });
    const probeLayer: Layer = {
      name: 'probe',
      wrap: (_trail, impl) => async (input, ctx) => {
        wrapped = true;
        return await impl(input, ctx);
      },
    };
    const t = trail('permit.before-effects', {
      blaze: (_input, ctx) => Result.ok({ ok: protectedResource.from(ctx).ok }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['entity:write'] },
      resources: [protectedResource],
    });

    const result = await executeTrail(t, {}, { layers: [probeLayer] });

    expect(result.isErr()).toBe(true);
    expect(result.error).toBeInstanceOf(PermitError);
    expect(created).toBe(false);
    expect(wrapped).toBe(false);
  });

  test('TRL-475: enforces permits without authLayer wiring (regression)', async () => {
    // Regression: after TRL-475 removed `authLayer` from @ontrails/permits,
    // permit enforcement must remain intrinsic to executeTrail. This trail
    // never declares any layer; the permit check is owned entirely by
    // enforcePermitRequirement inside executeTrail.
    const adminTrail = trail('permit.trl475', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['admin'] },
    });

    const result = await executeTrail(
      adminTrail,
      {},
      { ctx: { permit: { id: 'user', scopes: ['user'] } } }
    );

    expect(result.isErr()).toBe(true);
    expect(result.error).toBeInstanceOf(PermitError);
    expect(result.error.message).toContain('admin');
  });

  test('rechecks permit requirements across ctx.compose boundaries', async () => {
    const child = trail('permit.child', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['child:write'] },
      visibility: 'internal',
    });
    const parent = trail('permit.parent', {
      blaze: async (_input, ctx) => {
        const composed = await ctx.compose?.(child, {});
        return Result.ok({
          childError:
            composed?.isErr() === true ? composed.error.message : undefined,
        });
      },
      composes: [child],
      input: z.object({}),
      output: z.object({ childError: z.string().optional() }),
      permit: { scopes: ['parent:write'] },
    });
    const app = topo('permit-compose-topo', { child, parent });

    const result = await executeTrail(
      parent,
      {},
      {
        ctx: { permit: { id: 'permit-1', scopes: ['parent:write'] } },
        topo: app,
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      childError: 'Missing scopes: child:write',
    });
  });
});
