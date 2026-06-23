import { describe, expect, test } from 'bun:test';

import { Result, topo, trail } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { cliCommandRouteCoherence } from '../rules/cli-command-route-coherence.js';

const searchTrail = trail('wayfind.search', {
  blaze: () => Result.ok([]),
  cli: {
    aliases: ['find'],
  },
  input: z.object({ query: z.string() }),
  output: z.array(z.string()),
});

describe('cli-command-route-coherence', () => {
  test('stays quiet when aliases resolve to distinct command paths', async () => {
    const diagnostics = await cliCommandRouteCoherence.checkTopo(
      topo('cli-routes-clean', { searchTrail })
    );

    expect(diagnostics).toEqual([]);
  });

  test('errors when an alias collides with another command route', async () => {
    const collidingTrail = trail('wayfind.find', {
      blaze: () => Result.ok([]),
      input: z.object({ query: z.string() }),
      output: z.array(z.string()),
    });

    const diagnostics = await cliCommandRouteCoherence.checkTopo(
      topo('cli-routes-collide', { collidingTrail, searchTrail })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'CLI command route collision on "wayfind find": canonical route for trail "wayfind.find" (derived), alias route for trail "wayfind.search" (trail). Rename or remove one CLI alias so every accepted command path normalizes into exactly one trail contract.',
        rule: 'cli-command-route-coherence',
        severity: 'error',
      },
    ]);
  });

  test('errors when a string alias is more than one segment', async () => {
    const invalid = trail('wayfind.search', {
      blaze: () => Result.ok([]),
      cli: {
        aliases: ['wayfind find'],
      },
      input: z.object({ query: z.string() }),
      output: z.array(z.string()),
    });

    const diagnostics = await cliCommandRouteCoherence.checkTopo(
      topo('cli-routes-invalid', { invalid })
    );

    expect(diagnostics[0]).toMatchObject({
      filePath: '<topo>',
      line: 1,
      rule: 'cli-command-route-coherence',
      severity: 'error',
    });
    expect(diagnostics[0]?.message).toContain(
      'must be a single command segment'
    );
  });

  test('errors when serialized graph route facts target a missing trail', async () => {
    const app = topo('cli-routes-graph-target', { searchTrail });
    const graph = deriveTopoGraph(app);
    const corruptedGraph = {
      ...graph,
      entries: graph.entries.map((entry) =>
        entry.id === 'wayfind.search'
          ? {
              ...entry,
              cli: {
                path: ['wayfind', 'search'],
                routes: [
                  {
                    kind: 'alias' as const,
                    path: ['wf', 'search'],
                    source: 'surface' as const,
                    target: 'missing.trail',
                  },
                ],
              },
            }
          : entry
      ),
    };

    const diagnostics = await cliCommandRouteCoherence.checkTopo(app, {
      graph: corruptedGraph,
    });

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Serialized CLI command route "wf search" targets unknown trail "missing.trail". Surface-owned aliases must target existing trail IDs.',
        rule: 'cli-command-route-coherence',
        severity: 'error',
      },
    ]);
  });

  test('errors when serialized surface-owned aliases collide', async () => {
    const search = trail('wayfind.search', {
      blaze: () => Result.ok([]),
      input: z.object({ query: z.string() }),
      output: z.array(z.string()),
    });
    const collidingTrail = trail('wayfind.find', {
      blaze: () => Result.ok([]),
      input: z.object({ query: z.string() }),
      output: z.array(z.string()),
    });
    const app = topo('cli-routes-surface-collide', {
      collidingTrail,
      search,
    });
    const graph = deriveTopoGraph(app);
    const corruptedGraph = {
      ...graph,
      entries: graph.entries.map((entry) =>
        entry.id === 'wayfind.search'
          ? {
              ...entry,
              cli: {
                ...entry.cli,
                routes: [
                  ...(entry.cli?.routes ?? []),
                  {
                    kind: 'alias' as const,
                    path: ['wayfind', 'find'],
                    source: 'surface' as const,
                    target: 'wayfind.search',
                  },
                ],
              },
            }
          : entry
      ),
    };

    const diagnostics = await cliCommandRouteCoherence.checkTopo(app, {
      graph: corruptedGraph,
    });

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'CLI command route collision on "wayfind find": canonical route for trail "wayfind.find" (derived), alias route for trail "wayfind.search" (surface). Rename or remove one CLI alias so every accepted command path normalizes into exactly one trail contract.',
        rule: 'cli-command-route-coherence',
        severity: 'error',
      },
    ]);
  });

  test('runWarden dispatches the rule from wardenTopoRules', async () => {
    const collidingTrail = trail('wayfind.find', {
      blaze: () => Result.ok([]),
      input: z.object({ query: z.string() }),
      output: z.array(z.string()),
    });

    const result = await runWarden({
      mode: 'check',
      tier: 'topo-aware',
      topo: topo('cli-routes-run', { collidingTrail, searchTrail }),
    });

    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.rule === 'cli-command-route-coherence'
      )
    ).toBe(true);
  });
});
