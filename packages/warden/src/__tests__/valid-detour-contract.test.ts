import { describe, expect, test } from 'bun:test';

import { ConflictError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { validDetourContract } from '../rules/valid-detour-contract.js';

const validTrail = trail('entity.save', {
  detours: [
    {
      on: ConflictError,
      recover: async () => Result.ok({ ok: true }),
    },
  ],
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

describe('valid-detour-contract', () => {
  test('passes for detours with an error constructor and callable recover', async () => {
    const diagnostics = await validDetourContract.checkTopo(
      topo('valid-detour-contract', { validTrail })
    );

    expect(diagnostics).toEqual([]);
  });

  test('flags detours with a non-constructor on value', async () => {
    const malformed = {
      ...validTrail,
      detours: [
        {
          on: 'ConflictError',
          recover: async () => Result.ok({ ok: true }),
        },
      ],
    } as unknown as typeof validTrail;

    const diagnostics = await validDetourContract.checkTopo(
      topo('invalid-on', { malformed } as Record<string, unknown>)
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('valid-detour-contract');
    expect(diagnostics[0]?.message).toContain('error constructor');
  });

  test('flags detours with a non-callable recover value', async () => {
    const malformed = {
      ...validTrail,
      detours: [
        {
          on: ConflictError,
          recover: 'not callable',
        },
      ],
    } as unknown as typeof validTrail;

    const diagnostics = await validDetourContract.checkTopo(
      topo('invalid-recover', { malformed } as Record<string, unknown>)
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('valid-detour-contract');
    expect(diagnostics[0]?.message).toContain('callable recover');
    expect(diagnostics[0]?.message).toContain('recover: (attempt, ctx)');
    expect(diagnostics[0]?.message).toContain('attempt.error');
    expect(diagnostics[0]?.message).toContain('Result.err(...)');
  });

  test('reports both issues when on and recover are malformed', async () => {
    const malformed = {
      ...validTrail,
      detours: [
        {
          on: 'ConflictError',
          recover: 'not callable',
        },
      ],
    } as unknown as typeof validTrail;

    const diagnostics = await validDetourContract.checkTopo(
      topo('invalid-contract', { malformed } as Record<string, unknown>)
    );

    expect(diagnostics).toHaveLength(2);
  });
});
