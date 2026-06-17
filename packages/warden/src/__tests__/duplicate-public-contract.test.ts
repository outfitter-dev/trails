import { describe, expect, test } from 'bun:test';

import { Result, topo, trail } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import { z } from 'zod';

import { duplicatePublicContract } from '../rules/duplicate-public-contract.js';

const input = z.object({ target: z.string() });
const output = z.object({ ok: z.boolean() });

describe('duplicate-public-contract', () => {
  test('warns when two public trails expose the same normalized contract facts', async () => {
    const canonical = trail('survey.diff', {
      blaze: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const duplicate = trail('diff', {
      blaze: () => Result.ok({ ok: true }),
      input,
      output,
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('duplicate-contract', { canonical, duplicate })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Likely duplicate public trail contracts "diff", "survey.diff" share the same input, output, intent, permits, resources, composes, signals, and detours. Keep one contract with aliases/input mappings, compose a distinct wrapper, or document why these public contracts are separate.',
        rule: 'duplicate-public-contract',
        severity: 'warn',
      },
    ]);
  });

  test('stays quiet for Warden rule wrappers with matching schemas', async () => {
    const canonical = trail('warden.rule.a', {
      blaze: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const sibling = trail('warden.rule.b', {
      blaze: () => Result.ok({ ok: true }),
      input,
      output,
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('distinct-contract-metadata', { canonical, sibling })
    );

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet for graph entries without input/output contracts', async () => {
    const first = trail('operator.first', {
      blaze: () => Result.ok({ ok: true }),
    });
    const second = trail('operator.second', {
      blaze: () => Result.ok({ ok: true }),
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('no-contract-schemas', { first, second })
    );

    expect(diagnostics).toEqual([]);
  });

  test('uses provided graph facts when available', async () => {
    const canonical = trail('survey.diff', {
      blaze: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const duplicate = trail('diff', {
      blaze: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const app = topo('provided-graph', { canonical, duplicate });
    const graph = deriveTopoGraph(app);

    const diagnostics = await duplicatePublicContract.checkTopo(app, { graph });

    expect(diagnostics).toHaveLength(1);
  });
});
