import { describe, expect, test } from 'bun:test';

import { Result, topo, trail } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { libraryProjectionCoherence } from '../rules/library-projection-coherence.js';

const output = z.object({ ok: z.boolean() });

const buildTrail = (id: string) =>
  trail(id, {
    blaze: () => Result.ok({ ok: true }),
    input: z.object({}),
    output,
  });

describe('library-projection-coherence', () => {
  test('stays quiet for collision-free library projection facts', async () => {
    const app = topo('library-projection-clean', {
      first: buildTrail('widget.first'),
      second: buildTrail('widget.second'),
    });

    const diagnostics = await libraryProjectionCoherence.checkTopo(app);

    expect(diagnostics).toEqual([]);
  });

  test('errors when projected library export names collide', async () => {
    const app = topo('library-projection-collide', {
      dotted: buildTrail('widget.ping'),
      kebab: buildTrail('widget-ping'),
    });

    const diagnostics = await libraryProjectionCoherence.checkTopo(app);

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Library projection export collision on "widgetPing": trails "widget-ping", "widget.ping" derive the same package export. Rename one trail or add a library export override before materializing the generated package.',
        rule: 'library-projection-coherence',
        severity: 'error',
      },
    ]);
  });

  test('errors when serialized library export facts target a missing trail', async () => {
    const app = topo('library-projection-missing-target', {
      first: buildTrail('widget.first'),
    });
    const graph = deriveTopoGraph(app);
    const corruptedGraph = {
      ...graph,
      library: graph.library
        ? {
            ...graph.library,
            exports: graph.library.exports.map((entry) =>
              entry.exportName === 'widgetFirst'
                ? { ...entry, trailId: 'widget.missing' }
                : entry
            ),
          }
        : undefined,
    };

    const diagnostics = await libraryProjectionCoherence.checkTopo(app, {
      graph: corruptedGraph,
    });

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Library projection export "widgetFirst" targets unknown trail "widget.missing". Resolved library exports must stay attached to existing trail contracts.',
        rule: 'library-projection-coherence',
        severity: 'error',
      },
    ]);
  });

  test('runWarden dispatches the rule from wardenTopoRules', async () => {
    const report = await runWarden({
      topo: topo('library-projection-run', {
        dotted: buildTrail('widget.ping'),
        kebab: buildTrail('widget-ping'),
      }),
    });

    expect(
      report.diagnostics.some(
        (diagnostic) => diagnostic.rule === 'library-projection-coherence'
      )
    ).toBe(true);
  });
});
