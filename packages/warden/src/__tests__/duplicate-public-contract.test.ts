import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  entity,
  deriveTrail,
  resource,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import {
  deriveTopoGraph,
  deriveTopoGraphHash,
  readTopoGraph,
  writeTrailsLock,
} from '@ontrails/topography';
import { runWarden } from '../cli.js';
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
          'Likely duplicate public trail contracts "diff", "survey.diff" share the same input, output, intent, permits, resources, entities, composes, signals, detours, and authored meta. Keep one contract with aliases/input mappings, compose a distinct wrapper, or declare real semantic facts in meta (for example, correspondenceFact: "read" versus "ack") when these public contracts are distinct.',
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

  test('stays quiet for factory CRUD deletes anchored to different entities', async () => {
    const pack = entity(
      'pack',
      { id: z.string(), name: z.string() },
      { identity: 'id' }
    );
    const trip = entity(
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

  test('still warns for identical contracts anchored to the same entity', async () => {
    const pack = entity(
      'pack',
      { id: z.string(), name: z.string() },
      { identity: 'id' }
    );
    const canonical = trail('pack.remove', {
      entities: [pack],
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const duplicate = trail('pack.destroy', {
      entities: [pack],
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('same-entity-duplicates', { canonical, duplicate })
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('stays quiet for inverse operation pairs on the same scope', async () => {
    const pairs = [
      ['route.disable', 'route.enable'],
      ['check.pause', 'check.resume'],
      ['snippet.star', 'snippet.unstar'],
      ['document.archive', 'document.restore'],
    ] as const;

    for (const [disabled, enabled] of pairs) {
      const left = trail(disabled, {
        implementation: () => Result.ok({ ok: true }),
        input,
        output,
      });
      const right = trail(enabled, {
        implementation: () => Result.ok({ ok: true }),
        input,
        output,
      });

      const diagnostics = await duplicatePublicContract.checkTopo(
        topo(`inverse-${disabled}`, { left, right })
      );

      expect(diagnostics).toEqual([]);
    }
  });

  test('still warns when matching facts do not form an inverse operation pair', async () => {
    const first = trail('route.enable', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const second = trail('route.activate', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('non-inverse-duplicates', { first, second })
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('still warns for inverse operation names on different scopes', async () => {
    const disable = trail('route.disable', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const enable = trail('feature.enable', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('different-scope-inverses', { disable, enable })
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('still warns when an inverse pair shares its contract with a third trail', async () => {
    const disable = trail('route.disable', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const enable = trail('route.enable', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });
    const reset = trail('route.reset', {
      implementation: () => Result.ok({ ok: true }),
      input,
      output,
    });

    const diagnostics = await duplicatePublicContract.checkTopo(
      topo('crowded-inverse-contract', { disable, enable, reset })
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

describe('authored semantic metadata through normal graph derivation', () => {
  for (const [shape, firstMeta, secondMeta, expected] of [
    ['absent', undefined, undefined, 1],
    [
      'identical',
      { correspondenceFact: 'read' },
      { correspondenceFact: 'read' },
      1,
    ],
    [
      'distinct',
      { correspondenceFact: 'read' },
      { correspondenceFact: 'ack' },
      0,
    ],
    [
      'reordered',
      { correspondenceFact: 'read', detail: { a: 1, b: 2 } },
      Object.fromEntries([
        [
          'detail',
          Object.fromEntries([
            ['b', 2],
            ['a', 1],
          ]),
        ],
        ['correspondenceFact', 'read'],
      ]),
      1,
    ],
  ] as const) {
    test(`${shape} metadata preserves the correct duplicate coaching`, () => {
      const make = (
        id: string,
        meta: Readonly<Record<string, unknown>> | undefined
      ) =>
        trail(id, {
          implementation: () => Result.ok({ ok: true }),
          input,
          output,
          ...(meta === undefined ? {} : { meta }),
        });
      const read = make('message.read', firstMeta);
      const ack = make('message.ack', secondMeta);
      const app = topo('semantic-contract', { ack, read });
      expect(
        duplicatePublicContract.checkTopo(app, { graph: deriveTopoGraph(app) })
      ).toHaveLength(expected);
    });
  }
});

test('actual Warden dispatch preserves semantic meta after generated root-lock readback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trails-semantic-meta-'));
  try {
    for (const distinct of [false, true]) {
      const make = (id: string, fact: string) =>
        trail(id, {
          implementation: () => Result.ok({ ok: true }),
          input,
          meta: { correspondenceFact: fact },
          output,
        });
      const read = make('message.read', 'read');
      const ack = make('message.ack', distinct ? 'ack' : 'read');
      const app = topo('semantic-contract', { ack, read });
      const graph = deriveTopoGraph(app);
      await writeTrailsLock(
        {
          scope: { app: app.name },
          summary: { entities: 0, resources: 0, signals: 0, trails: 2 },
          topoGraph: graph,
          topoGraphHash: deriveTopoGraphHash(graph),
          version: 5,
        },
        { dir: root }
      );
      const loaded = await readTopoGraph({ dir: root });
      if (!loaded) {
        throw new Error('Expected generated graph');
      }
      const report = await runWarden({
        noLockMutation: true,
        projectRules: false,
        rootDir: root,
        tier: 'topo-aware',
        topos: [{ graph: loaded, topo: app }],
      });
      expect(
        report.diagnostics.filter(
          (diagnostic) => diagnostic.rule === 'duplicate-public-contract'
        )
      ).toHaveLength(distinct ? 0 : 1);
      expect(
        report.diagnostics.filter(
          (diagnostic) => diagnostic.severity === 'error'
        )
      ).toEqual([]);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
