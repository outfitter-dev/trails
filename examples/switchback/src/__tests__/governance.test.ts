/**
 * Governance gates for the showcase, enforced in CI:
 * - Warden reports zero errors for the switchback topo, including the
 *   topo-aware library-render-coherence rule.
 * - The committed trails.lock matches the current graph (no drift).
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { deriveTopoGraph } from '@ontrails/topography';
import { runWarden } from '@ontrails/warden';

import { app } from '../app.js';

const appRoot = join(import.meta.dir, '..', '..');

describe('warden', () => {
  test('zero errors and no lock drift for the switchback topo', async () => {
    const report = await runWarden({
      rootDir: appRoot,
      topos: [{ graph: deriveTopoGraph(app), name: 'switchback', topo: app }],
    });
    const errors = report.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error'
    );
    expect(errors).toEqual([]);
    expect(report.errorCount).toBe(0);
    expect(report.drift?.stale ?? false).toBe(false);
  });
});

describe('trails.lock', () => {
  test('committed lock embeds the collision-free library rendering', async () => {
    const lock = (await Bun.file(join(appRoot, 'trails.lock')).json()) as {
      topoGraph: {
        library?: {
          collisions: unknown[];
          exports: { exportName: string }[];
        };
      };
    };
    expect(lock.topoGraph.library?.collisions).toEqual([]);
    expect(
      lock.topoGraph.library?.exports.map((entry) => entry.exportName)
    ).toContain('flagEvaluate');
  });
});
