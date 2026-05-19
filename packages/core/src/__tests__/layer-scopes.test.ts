/**
 * TRL-472: Three attachment scopes for typed layers — trail, surface, topo.
 *
 * Verifies that layers attach declaratively at each scope and compose at
 * execute time in the order topo → surface → trail → blaze (outermost-first).
 */

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { executeTrail } from '../execute';
import type { Layer } from '../layer';
import { Result } from '../result';
import { topo } from '../topo';
import { trail } from '../trail';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const recordingLayer = (label: string, log: string[]): Layer => ({
  name: label,
  wrap(_t, impl) {
    return async (input, ctx) => {
      log.push(`${label}:before`);
      const result = await impl(input, ctx);
      log.push(`${label}:after`);
      return result;
    };
  },
});

const buildEchoTrail = (extra: { readonly layers?: readonly Layer[] } = {}) =>
  trail('echo', {
    blaze: (input) => Result.ok({ value: input.value }),
    input: z.object({ value: z.string() }),
    output: z.object({ value: z.string() }),
    ...(extra.layers === undefined ? {} : { layers: extra.layers }),
  });

// ---------------------------------------------------------------------------
// Trail-level attachment
// ---------------------------------------------------------------------------

describe('trail-level layers', () => {
  test('a trail with `layers` runs through those layers', async () => {
    const log: string[] = [];
    const layerA = recordingLayer('A', log);
    const echo = buildEchoTrail({ layers: [layerA] });

    const result = await executeTrail(echo, { value: 'hello' });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ value: 'hello' });
    expect(log).toEqual(['A:before', 'A:after']);
  });

  test('trail.layers is normalized to a frozen array (default [])', () => {
    const echo = buildEchoTrail();
    expect(Array.isArray(echo.layers)).toBe(true);
    expect(echo.layers.length).toBe(0);
    expect(Object.isFrozen(echo.layers)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Surface-level attachment
// ---------------------------------------------------------------------------

describe('surface-level layers', () => {
  test('surfaceLayers wrap the blaze', async () => {
    const log: string[] = [];
    const layerB = recordingLayer('B', log);
    const echo = buildEchoTrail();

    const result = await executeTrail(
      echo,
      { value: 'hi' },
      { surfaceLayers: [layerB] }
    );

    expect(result.isOk()).toBe(true);
    expect(log).toEqual(['B:before', 'B:after']);
  });
});

// ---------------------------------------------------------------------------
// Topo-level attachment
// ---------------------------------------------------------------------------

describe('topo-level layers', () => {
  test('topo.layers is exposed via topo() third argument', () => {
    const log: string[] = [];
    const layerC = recordingLayer('C', log);
    const echo = buildEchoTrail();
    const app = topo('app', { echo }, { layers: [layerC] });

    expect(app.layers.length).toBe(1);
    expect(app.layers[0]?.name).toBe('C');
  });

  test('topo.layers default to [] when no options are passed', () => {
    const echo = buildEchoTrail();
    const app = topo('app', { echo });
    expect(app.layers).toEqual([]);
  });

  test('topoLayers wrap the blaze', async () => {
    const log: string[] = [];
    const layerC = recordingLayer('C', log);
    const echo = buildEchoTrail();
    const app = topo('app', { echo }, { layers: [layerC] });

    const result = await executeTrail(
      echo,
      { value: 'hi' },
      { topo: app, topoLayers: app.layers }
    );

    expect(result.isOk()).toBe(true);
    expect(log).toEqual(['C:before', 'C:after']);
  });
});

// ---------------------------------------------------------------------------
// Composition order — topo outermost → trail innermost
// ---------------------------------------------------------------------------

describe('layer composition order', () => {
  test('runs C → B → A → blaze when topo, surface, and trail layers all present', async () => {
    const log: string[] = [];
    const layerA = recordingLayer('A', log);
    const layerB = recordingLayer('B', log);
    const layerC = recordingLayer('C', log);

    const echo = buildEchoTrail({ layers: [layerA] });
    const app = topo('app', { echo }, { layers: [layerC] });

    const result = await executeTrail(
      echo,
      { value: 'go' },
      {
        surfaceLayers: [layerB],
        topo: app,
        topoLayers: app.layers,
      }
    );

    expect(result.isOk()).toBe(true);
    expect(log).toEqual([
      'C:before',
      'B:before',
      'A:before',
      'A:after',
      'B:after',
      'C:after',
    ]);
  });
});

// ---------------------------------------------------------------------------
// `topo.options` brand still accepts layers
// ---------------------------------------------------------------------------

describe('topo.options branding', () => {
  test('layers can travel through topo.options() without ambiguity', () => {
    const log: string[] = [];
    const layerC = recordingLayer('C', log);
    const echo = buildEchoTrail();
    const app = topo('app', { echo }, topo.options({ layers: [layerC] }));

    expect(app.layers.length).toBe(1);
  });
});
