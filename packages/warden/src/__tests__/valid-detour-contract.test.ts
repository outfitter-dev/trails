import { describe, expect, test } from 'bun:test';

import { ConflictError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { validDetourContract } from '../rules/valid-detour-contract.js';

const validTrail = trail('entity.save', {
  blaze: () => Result.ok({ ok: true }),
  detours: [
    {
      on: ConflictError,
      recover: () => Result.ok({ ok: true }),
    },
  ],
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

describe('valid-detour-contract', () => {
  test('passes for detours with an error constructor and callable recover', () => {
    const diagnostics = validDetourContract.checkTopo(
      topo('valid-detour-contract', { validTrail })
    );

    expect(diagnostics).toEqual([]);
  });

  test('flags detours with a non-constructor on value', () => {
    const malformed = {
      ...validTrail,
      detours: [
        {
          on: 'ConflictError',
          recover: () => Result.ok({ ok: true }),
        },
      ],
    } as typeof validTrail;

    const diagnostics = validDetourContract.checkTopo(
      topo('invalid-on', { malformed } as Record<string, unknown>)
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('valid-detour-contract');
    expect(diagnostics[0]?.message).toContain('error constructor');
  });

  test('flags detours with a non-callable recover value', () => {
    const malformed = {
      ...validTrail,
      detours: [
        {
          on: ConflictError,
          recover: 'not callable',
        },
      ],
    } as typeof validTrail;

    const diagnostics = validDetourContract.checkTopo(
      topo('invalid-recover', { malformed } as Record<string, unknown>)
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('valid-detour-contract');
    expect(diagnostics[0]?.message).toContain('callable recover');
  });

  test('reports both issues when on and recover are malformed', () => {
    const malformed = {
      ...validTrail,
      detours: [
        {
          on: 'ConflictError',
          recover: 'not callable',
        },
      ],
    } as typeof validTrail;

    const diagnostics = validDetourContract.checkTopo(
      topo('invalid-contract', { malformed } as Record<string, unknown>)
    );

    expect(diagnostics).toHaveLength(2);
  });
});
