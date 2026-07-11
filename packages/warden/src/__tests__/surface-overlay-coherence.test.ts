import { describe, expect, test } from 'bun:test';

import { Result, surfaceOverlay, topo, trail } from '@ontrails/core';
import type { SurfaceOverlayBindings, Topo } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import type { TopoGraph } from '@ontrails/topographer';
import { z } from 'zod';

import { surfaceOverlayCoherence } from '../rules/surface-overlay-coherence.js';

const gearList = trail('gear.list', {
  implementation: () => Result.ok([]),
  input: z.object({}),
  output: z.array(z.string()),
});

const gearCreate = trail('gear.create', {
  implementation: () => Result.ok([]),
  input: z.object({ name: z.string() }),
  output: z.array(z.string()),
});

const survey = trail('survey', {
  implementation: () => Result.ok([]),
  input: z.object({}),
  output: z.array(z.string()),
});

const buildApp = (): Topo => topo('demo', { gearCreate, gearList, survey });

const graphWithSurfaces = (
  app: Topo,
  bindings: SurfaceOverlayBindings
): TopoGraph => ({
  ...deriveTopoGraph(app),
  overlays: { surfaces: bindings },
});

describe('surface-overlay-coherence', () => {
  test('stays quiet when no graph or overlays are available', async () => {
    const app = buildApp();
    expect(await surfaceOverlayCoherence.checkTopo(app)).toEqual([]);
    expect(
      await surfaceOverlayCoherence.checkTopo(app, {
        graph: deriveTopoGraph(app),
      })
    ).toEqual([]);
  });

  test('stays quiet when the overlays record has no surfaces namespace', async () => {
    const app = buildApp();
    const graph: TopoGraph = {
      ...deriveTopoGraph(app),
      overlays: { cloudflare: { regions: ['us-east'] } },
    };

    expect(await surfaceOverlayCoherence.checkTopo(app, { graph })).toEqual([]);
  });

  test('a clean overlay yields no diagnostics', async () => {
    const app = buildApp();
    const graph = graphWithSurfaces(app, {
      cli: { gear: ['gear.create', 'gear.list'], ls: 'gear.list' },
      mcp: { gears: ['gear.*'] },
    });

    expect(await surfaceOverlayCoherence.checkTopo(app, { graph })).toEqual([]);
  });

  test('warns when a binding ref matches no trails', async () => {
    const app = buildApp();
    const graph = graphWithSurfaces(app, {
      cli: { snips: ['snippet.*'] },
    });

    const diagnostics = await surfaceOverlayCoherence.checkTopo(app, {
      graph,
    });

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Surface overlay binding "snips" on "cli" references "snippet.*", which matches no trails in the topo. Point the binding at an existing trail id or dotted trail-id glob.',
        rule: 'surface-overlay-coherence',
        severity: 'warn',
      },
    ]);
  });

  test('warns when two groups on the same surface overlap on expanded members', async () => {
    const app = buildApp();
    const graph = graphWithSurfaces(app, {
      mcp: {
        catalog: ['gear.*'],
        gears: ['gear.create', 'gear.list'],
      },
    });

    const diagnostics = await surfaceOverlayCoherence.checkTopo(app, {
      graph,
    });

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Surface overlay group "gears" on "mcp" overlaps group "catalog" on trail "gear.create". Narrow one group so each trail has one grouped owner per surface.',
        rule: 'surface-overlay-coherence',
        severity: 'warn',
      },
    ]);
  });

  test('does not warn when groups on different surfaces share members', async () => {
    const app = buildApp();
    const graph = graphWithSurfaces(app, {
      cli: { gears: ['gear.*'] },
      mcp: { catalog: ['gear.*'] },
    });

    expect(await surfaceOverlayCoherence.checkTopo(app, { graph })).toEqual([]);
  });

  test('warns when a cli binding name shadows a canonical single-segment command', async () => {
    const app = buildApp();
    const graph = graphWithSurfaces(app, {
      cli: { survey: 'gear.list' },
    });

    const diagnostics = await surfaceOverlayCoherence.checkTopo(app, {
      graph,
    });

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Surface overlay binding "survey" on "cli" shadows the canonical CLI route "survey" for trail "survey". Rename the binding so it does not shadow a real entry.',
        rule: 'surface-overlay-coherence',
        severity: 'warn',
      },
    ]);
  });

  test('warns when a cli binding name shadows a single-segment trail-owned alias route', async () => {
    const aliasedList = trail('gear.aliased-list', {
      cli: { aliases: [['ls-cmd']] },
      implementation: () => Result.ok([]),
      input: z.object({}),
      output: z.array(z.string()),
    });
    const app = topo('demo', { aliasedList, gearCreate });
    const graph = graphWithSurfaces(app, {
      cli: { 'ls-cmd': 'gear.create' },
    });

    const diagnostics = await surfaceOverlayCoherence.checkTopo(app, {
      graph,
    });

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Surface overlay binding "ls-cmd" on "cli" shadows the alias CLI route "ls-cmd" for trail "gear.aliased-list". Rename the binding so it does not shadow a real entry.',
        rule: 'surface-overlay-coherence',
        severity: 'warn',
      },
    ]);
  });

  test('does not warn when a cli binding name matches only its own projected surface route', async () => {
    const app = buildApp();
    // The binding "ls" itself projects the single-segment alias route
    // ["ls"] into the graph; that self-projection is not shadowing.
    const graph: TopoGraph = {
      ...deriveTopoGraph(app, {
        overlays: [surfaceOverlay({ cli: { ls: 'gear.list' } })],
      }),
      overlays: { surfaces: { cli: { ls: 'gear.list' } } },
    };

    expect(await surfaceOverlayCoherence.checkTopo(app, { graph })).toEqual([]);
  });

  test('warns when an mcp binding name shadows a derived tool name', async () => {
    const app = buildApp();
    const graph = graphWithSurfaces(app, {
      mcp: { demo_gear_list: ['gear.list', 'gear.create'] },
    });

    const diagnostics = await surfaceOverlayCoherence.checkTopo(app, {
      graph,
    });

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Surface overlay binding "demo_gear_list" on "mcp" shadows the derived MCP tool name "demo_gear_list" for trail "gear.list". Rename the binding so it does not shadow a real entry.',
        rule: 'surface-overlay-coherence',
        severity: 'warn',
      },
    ]);
  });

  test('emits one warn diagnostic naming the namespace for a schema-invalid overlay', async () => {
    const app = buildApp();
    const graph: TopoGraph = {
      ...deriveTopoGraph(app),
      overlays: { surfaces: { graphql: { ls: 'gear.list' } } },
    };

    const diagnostics = await surfaceOverlayCoherence.checkTopo(app, {
      graph,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      filePath: '<topo>',
      line: 1,
      rule: 'surface-overlay-coherence',
      severity: 'warn',
    });
    expect(diagnostics[0]?.message).toContain('"surfaces"');
    expect(diagnostics[0]?.message).toContain('invalid');
  });
});
