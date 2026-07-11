import { describe, expect, test } from 'bun:test';

import {
  contour,
  deriveTrail,
  resource,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import { z } from 'zod';

import { duplicatePublicContract } from '../rules/duplicate-public-contract.js';

const input = z.object({ target: z.string() });
const output = z.object({ ok: z.boolean() });

describe('duplicate-public-contract', () => {
  test('warns when two public trails expose the same normalized contract facts', async () => {
    const canonical = trail('survey.diff', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const duplicate = trail('diff', {
      implementation: () => Result.ok({ ok: true }),
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
          'Likely duplicate public trail contracts "diff", "survey.diff" share the same input, output, intent, permits, resources, contours, composes, signals, and detours. Keep one contract with aliases/input mappings, compose a distinct wrapper, or document why these public contracts are separate.',
        rule: 'duplicate-public-contract',
        severity: 'warn',
      },
    ]);
  });

  test('stays quiet for Warden rule wrappers with matching schemas', async () => {
    const canonical = trail('warden.rule.a', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const sibling = trail('warden.rule.b', {
      implementation: () => Result.ok({ ok: true }),
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
      implementation: () => Result.ok({ ok: true }),
    });
    const second = trail('operator.second', {
      implementation: () => Result.ok({ ok: true }),
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('no-contract-schemas', { first, second })
    );

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet for factory CRUD deletes anchored to different contours', async () => {
    const pack = contour(
      'pack',
      { id: z.string(), name: z.string() },
      { identity: 'id' }
    );
    const trip = contour(
      'trip',
      { id: z.string(), name: z.string() },
      { identity: 'id' }
    );
    const db = resource('db.main', {
      create: () => Result.ok({}),
      mock: () => ({}),
    });
    const packDelete = deriveTrail(pack, 'delete', {
      implementation: () => Result.ok(),
      resource: db,
    });
    const tripDelete = deriveTrail(trip, 'delete', {
      implementation: () => Result.ok(),
      resource: db,
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('factory-crud-tables', { db, packDelete, tripDelete })
    );

    expect(diagnostics).toEqual([]);
  });

  test('still warns for identical contracts anchored to the same contour', async () => {
    const pack = contour(
      'pack',
      { id: z.string(), name: z.string() },
      { identity: 'id' }
    );
    const canonical = trail('pack.remove', {
      contours: [pack],
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const duplicate = trail('pack.destroy', {
      contours: [pack],
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('same-contour-duplicates', { canonical, duplicate })
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('uses provided graph facts when available', async () => {
    const canonical = trail('survey.diff', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const duplicate = trail('diff', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const app = topo('provided-graph', { canonical, duplicate });
    const graph = deriveTopoGraph(app);

    const diagnostics = await duplicatePublicContract.checkTopo(app, { graph });

    expect(diagnostics).toHaveLength(1);
  });
});
