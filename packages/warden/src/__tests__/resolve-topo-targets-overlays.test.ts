import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { runWarden } from '../cli.js';
import { resolveWardenTopoTargets } from '../command.js';

const fixtureParent = resolve(import.meta.dir, '../..', '.tmp-tests');

let fixtureDir: string | undefined;

afterEach(() => {
  if (fixtureDir) {
    rmSync(fixtureDir, { force: true, recursive: true });
    fixtureDir = undefined;
  }
});

const newFixtureDir = (): string => {
  fixtureDir = join(
    fixtureParent,
    `warden-overlays-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  return fixtureDir;
};

const writeAppModule = (dir: string, appSource: string): void => {
  mkdirSync(join(dir, 'apps', 'demo', 'src'), { recursive: true });
  writeFileSync(join(dir, 'apps', 'demo', 'src', 'app.ts'), appSource);
};

const incoherentOverlayApp = `import { Result, surfaceOverlay, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const listGear = trail('gear.list', {
  blaze: async () => Result.ok({ items: [] }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ items: z.array(z.string()) }),
});

export const app = topo('warden-overlay-fixture', { listGear });
export const trailsOverlays = [
  surfaceOverlay({ cli: { ghost: 'no.such.trail' } }),
];
`;

describe('warden topo targets carry app-module overlays (TRL-1209)', () => {
  test('resolveWardenTopoTargets loads trailsOverlays and topo-aware dispatch fires surface-overlay-coherence', async () => {
    const dir = newFixtureDir();
    writeAppModule(dir, incoherentOverlayApp);

    const resolved = await resolveWardenTopoTargets({
      rootDir: dir,
      strict: true,
    });

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.topos).toHaveLength(1);
    expect(resolved.topos[0]?.overlays).toHaveLength(1);
    expect(resolved.topos[0]?.overlays?.[0]?.namespace).toBe('surfaces');

    const report = await runWarden({
      rootDir: dir,
      tier: 'topo-aware',
      topos: resolved.topos,
    });

    const finding = report.diagnostics.find(
      (diagnostic) => diagnostic.rule === 'surface-overlay-coherence'
    );
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('ghost');
    expect(finding?.message).toContain('matches no trails');
  });

  test('an invalid trailsOverlays export surfaces as a topo-load diagnostic, not a crash', async () => {
    const dir = newFixtureDir();
    writeAppModule(
      dir,
      `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const listGear = trail('gear.list', {
  blaze: async () => Result.ok({ items: [] }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ items: z.array(z.string()) }),
});

export const app = topo('warden-overlay-fixture', { listGear });
export const trailsOverlays = 42;
`
    );

    const resolved = await resolveWardenTopoTargets({
      rootDir: dir,
      strict: true,
    });

    expect(resolved.topos).toHaveLength(0);
    expect(resolved.diagnostics).toHaveLength(1);
    expect(resolved.diagnostics[0]).toMatchObject({
      rule: 'topo-load',
      severity: 'error',
    });
    expect(resolved.diagnostics[0]?.message).toContain('trailsOverlays');
  });
});
