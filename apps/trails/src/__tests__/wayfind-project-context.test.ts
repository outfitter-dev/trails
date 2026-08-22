/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk/isErr */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NotFoundError,
  Result,
  ValidationError,
  topo,
  trail,
} from '@ontrails/core';
import {
  deriveTopoGraph,
  deriveTopoGraphHash,
  writeTrailsLock,
} from '@ontrails/topography';
import type { TopoGraph, TrailsLock } from '@ontrails/topography';

import { wayfindDiffTrail, wayfindTrail } from '../trails/wayfind.js';

const tempRoots: string[] = [];
const coreModuleUrl = import.meta.resolve('@ontrails/core');

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

const graphFor = (appId: string, trailId: string): TopoGraph =>
  deriveTopoGraph(
    topo(appId, {
      fixtureTrail: trail(trailId, {
        implementation: () => Result.ok({ ok: true }),
        input: undefined,
        intent: 'read',
      }),
    })
  );

const summaryFor = (graph: TopoGraph): TrailsLock['summary'] => ({
  entities: graph.entries.filter((entry) => entry.kind === 'entity').length,
  resources: graph.entries.filter((entry) => entry.kind === 'resource').length,
  signals: graph.entries.filter((entry) => entry.kind === 'signal').length,
  trails: graph.entries.filter((entry) => entry.kind === 'trail').length,
});

const writeAppLock = async (
  root: string,
  appId: string,
  trailId: string,
  graphAppId: string = appId
): Promise<void> => {
  const graph = graphFor(graphAppId, trailId);
  await writeTrailsLock(
    {
      scope: { app: graphAppId },
      summary: summaryFor(graph),
      topoGraph: graph,
      topoGraphHash: deriveTopoGraphHash(graph),
      version: 5,
    },
    { dir: join(root, 'apps', appId) }
  );
};

const createWorkspace = async (
  locks: Readonly<Record<string, string>>
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'trails-wayfind-project-'));
  tempRoots.push(root);
  await Promise.all([
    mkdir(join(root, 'apps', 'alpha'), { recursive: true }),
    mkdir(join(root, 'apps', 'beta'), { recursive: true }),
  ]);
  await Bun.write(
    join(root, 'trails.config.json'),
    `${JSON.stringify(
      {
        workspace: {
          apps: {
            alpha: { root: 'apps/alpha' },
            beta: { root: 'apps/beta' },
          },
        },
      },
      null,
      2
    )}\n`
  );
  await Promise.all(
    Object.entries(locks).map(([appId, trailId]) =>
      writeAppLock(root, appId, trailId)
    )
  );
  return root;
};

const fakeWayfindContext = (cwd: string) => {
  const calls: { readonly id: string; readonly input: unknown }[] = [];
  return {
    calls,
    ctx: {
      compose: async (id: string, input: unknown) => {
        calls.push({ id, input });
        return Result.ok({ id, input });
      },
      cwd,
    },
  };
};

describe('Wayfinder shared project context', () => {
  test('discovers a sole nested standalone app for live navigation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trails-wayfind-standalone-'));
    tempRoots.push(root);
    await mkdir(join(root, 'apps', 'solo', 'src'), { recursive: true });
    await writeFile(
      join(root, 'apps', 'solo', 'src', 'app.ts'),
      'export {};\n'
    );
    const facts = fakeWayfindContext(root);
    const input = wayfindTrail.input.parse({
      overview: true,
      rootDir: root,
      source: 'live',
    });

    const result = await wayfindTrail.implementation(input, facts.ctx);

    expect(result.isOk()).toBe(true);
    expect(facts.calls).toEqual([
      {
        id: 'survey',
        input: {
          module: 'apps/solo/src/app.ts',
          rootDir: root,
        },
      },
    ]);
    if (result.isOk()) {
      expect(result.value.project).toMatchObject({
        app: { modulePath: 'apps/solo/src/app.ts' },
        selectedExtent: 'standalone-app',
      });
    }
  });

  test('preserves an explicit standalone module for live navigation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trails-wayfind-explicit-'));
    tempRoots.push(root);
    const facts = fakeWayfindContext(root);
    const input = wayfindTrail.input.parse({
      module: 'custom/app.ts',
      overview: true,
      rootDir: root,
      source: 'live',
    });

    const result = await wayfindTrail.implementation(input, facts.ctx);

    expect(result.isOk()).toBe(true);
    expect(facts.calls).toEqual([
      {
        id: 'survey',
        input: { module: 'custom/app.ts', rootDir: root },
      },
    ]);
  });

  test('does not discover standalone source modules for locked navigation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trails-wayfind-locked-'));
    tempRoots.push(root);
    await mkdir(join(root, 'apps', 'solo', 'src'), { recursive: true });
    await writeFile(
      join(root, 'apps', 'solo', 'src', 'app.ts'),
      'export {};\n'
    );
    const facts = fakeWayfindContext(root);
    const input = wayfindTrail.input.parse({ overview: true, rootDir: root });

    const result = await wayfindTrail.implementation(input, facts.ctx);

    expect(result.isOk()).toBe(true);
    expect(facts.calls).toEqual([
      { id: 'wayfind.overview', input: { rootDir: root } },
    ]);
    if (result.isOk()) {
      expect(result.value.project).toMatchObject({
        app: { modulePath: 'src/app.ts' },
        selectedExtent: 'standalone-app',
      });
    }
  });

  test('selects one configured app without requiring unrelated locks', async () => {
    const root = await createWorkspace({ alpha: 'alpha.show' });
    const facts = fakeWayfindContext(root);
    const input = wayfindTrail.input.parse({
      app: 'alpha',
      overview: true,
      rootDir: root,
    });

    const result = await wayfindTrail.implementation(input, facts.ctx);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(facts.calls).toEqual([
      {
        id: 'wayfind.overview',
        input: { rootDir: join(root, 'apps', 'alpha') },
      },
    ]);
    expect(result.value).toMatchObject({
      project: {
        app: {
          appId: 'alpha',
          artifactPath: join(root, 'apps/alpha/trails.lock'),
        },
        configuredAppIds: ['alpha', 'beta'],
        selectedExtent: 'configured-app',
        selectionProvenance: 'app',
      },
      source: 'locked',
      view: 'overview',
    });
  });

  test('rejects a selected saved artifact bound to another app ID', async () => {
    const root = await createWorkspace({ alpha: 'alpha.show' });
    await writeAppLock(root, 'alpha', 'other.show', 'other');
    const facts = fakeWayfindContext(root);
    const input = wayfindTrail.input.parse({
      app: 'alpha',
      overview: true,
      rootDir: root,
    });

    const result = await wayfindTrail.implementation(input, facts.ctx);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(
        'does not match its Config-owned identity'
      );
    }
    expect(facts.calls).toHaveLength(0);
  });

  test('lets the selected app loader report a missing saved artifact', async () => {
    const root = await createWorkspace({});
    const calls: string[] = [];
    const input = wayfindTrail.input.parse({
      app: 'alpha',
      overview: true,
      rootDir: root,
    });

    const result = await wayfindTrail.implementation(input, {
      compose: async (id: string) => {
        calls.push(id);
        return Result.err(new NotFoundError('missing selected lock'));
      },
      cwd: root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.message).toBe('missing selected lock');
    }
    expect(calls).toEqual(['wayfind.overview']);
  });

  test('lets the selected app loader report an invalid saved artifact', async () => {
    const root = await createWorkspace({});
    await Bun.write(join(root, 'apps/alpha/trails.lock'), '{ invalid\n');
    const calls: string[] = [];
    const input = wayfindTrail.input.parse({
      app: 'alpha',
      overview: true,
      rootDir: root,
    });

    const result = await wayfindTrail.implementation(input, {
      compose: async (id: string) => {
        calls.push(id);
        return Result.err(new ValidationError('invalid selected lock'));
      },
      cwd: root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toBe('invalid selected lock');
    }
    expect(calls).toEqual(['wayfind.overview']);
  });

  test('rejects a selected live topo whose name differs from Config', async () => {
    const root = await createWorkspace({ alpha: 'alpha.show' });
    await mkdir(join(root, 'apps/alpha/src'), { recursive: true });
    await writeFile(
      join(root, 'apps/alpha/src/app.ts'),
      `import { topo } from ${JSON.stringify(coreModuleUrl)};\nexport const app = topo('other', []);\n`
    );
    const facts = fakeWayfindContext(root);
    const input = wayfindTrail.input.parse({
      app: 'alpha',
      overview: true,
      rootDir: root,
      source: 'live',
    });

    const result = await wayfindTrail.implementation(input, facts.ctx);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('loaded topo "other"');
    }
    expect(facts.calls).toHaveLength(0);
  });

  test('rejects --app on the source-file outline exception', async () => {
    const root = await createWorkspace({ alpha: 'alpha.show' });
    const facts = fakeWayfindContext(root);
    const input = wayfindTrail.input.parse({
      app: 'alpha',
      outline: true,
      rootDir: root,
      target: 'src/app.ts',
    });

    const result = await wayfindTrail.implementation(input, facts.ctx);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('do not accept --app');
    }
    expect(facts.calls).toHaveLength(0);
  });

  test('labels a partial saved workspace view instead of inventing completeness', async () => {
    const root = await createWorkspace({ alpha: 'alpha.show' });
    const facts = fakeWayfindContext(root);
    const input = wayfindTrail.input.parse({ overview: true, rootDir: root });

    const result = await wayfindTrail.implementation(input, facts.ctx);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toMatchObject({
      project: { selectedExtent: 'workspace' },
      result: {
        apps: [{ appId: 'alpha', appRoot: 'apps/alpha' }],
        evidence: { configuredCompleteness: 'partial' },
        workspaceViewHash: null,
      },
      view: 'overview',
    });
    expect(facts.calls).toHaveLength(1);
  });

  test('workspace target navigation keeps the uniquely matching app', async () => {
    const root = await createWorkspace({
      alpha: 'alpha.show',
      beta: 'beta.show',
    });
    const calls: string[] = [];
    const input = wayfindTrail.input.parse({
      rootDir: root,
      target: 'beta.show',
    });

    const result = await wayfindTrail.implementation(input, {
      compose: async (_id: string, childInput: { rootDir?: string }) => {
        const childRoot = childInput.rootDir ?? '';
        calls.push(childRoot);
        return childRoot.endsWith('apps/alpha')
          ? Result.err(new NotFoundError('not in alpha'))
          : Result.ok({ trailId: 'beta.show' });
      },
      cwd: root,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(calls).toEqual([join(root, 'apps/alpha'), join(root, 'apps/beta')]);
    expect(result.value).toMatchObject({
      result: { apps: [{ appId: 'beta' }] },
    });
  });

  test('workspace target navigation reports incomplete evidence when no saved app artifact is available', async () => {
    const root = await createWorkspace({});
    const facts = fakeWayfindContext(root);
    const input = wayfindTrail.input.parse({
      rootDir: root,
      target: 'alpha.show',
    });

    const result = await wayfindTrail.implementation(input, facts.ctx);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('alpha.show');
      expect(result.error.message).toContain('evidence is incomplete');
      expect((result.error as ValidationError).context).toMatchObject({
        evidence: { configuredCompleteness: 'partial' },
        reason: 'workspace-incomplete',
        target: 'alpha.show',
      });
    }
    expect(facts.calls).toHaveLength(0);
  });

  test('workspace target navigation does not infer absence from a partial view', async () => {
    const root = await createWorkspace({ alpha: 'alpha.show' });
    const calls: string[] = [];
    const input = wayfindTrail.input.parse({
      rootDir: root,
      target: 'missing.show',
    });

    const result = await wayfindTrail.implementation(input, {
      compose: async (_id: string, childInput: { rootDir?: string }) => {
        calls.push(childInput.rootDir ?? '');
        return Result.err(new NotFoundError('not in alpha'));
      },
      cwd: root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect((result.error as ValidationError).context).toMatchObject({
        evidence: { configuredCompleteness: 'partial' },
        reason: 'workspace-incomplete',
        target: 'missing.show',
      });
    }
    expect(calls).toEqual([join(root, 'apps/alpha')]);
  });

  test('workspace target navigation preserves a proven match from a partial view', async () => {
    const root = await createWorkspace({ alpha: 'alpha.show' });
    const input = wayfindTrail.input.parse({
      rootDir: root,
      target: 'alpha.show',
    });

    const result = await wayfindTrail.implementation(input, {
      compose: async () => Result.ok({ trailId: 'alpha.show' }),
      cwd: root,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toMatchObject({
      result: {
        apps: [{ appId: 'alpha' }],
        evidence: { configuredCompleteness: 'partial' },
      },
    });
  });

  test('workspace target navigation returns definitive not-found for a complete view', async () => {
    const root = await createWorkspace({
      alpha: 'alpha.show',
      beta: 'beta.show',
    });
    const input = wayfindTrail.input.parse({
      rootDir: root,
      target: 'missing.show',
    });

    const result = await wayfindTrail.implementation(input, {
      compose: async () => Result.err(new NotFoundError('target absent')),
      cwd: root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.message).toBe('target absent');
    }
  });

  test('diffs one configured app across roots without requiring unrelated locks', async () => {
    const current = await createWorkspace({ alpha: 'alpha.current' });
    const baseline = await createWorkspace({ alpha: 'alpha.baseline' });
    const input = wayfindDiffTrail.input.parse({
      againstRootDir: baseline,
      app: 'alpha',
      rootDir: current,
    });

    const result = await wayfindDiffTrail.implementation(input, {
      cwd: current,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toMatchObject({
      against: {
        source: { path: join(baseline, 'apps/alpha/trails.lock') },
      },
      diff: { hasBreaking: true },
      project: {
        app: { appId: 'alpha' },
        selectedExtent: 'configured-app',
      },
      source: { path: join(current, 'apps/alpha/trails.lock') },
    });
  });

  test('lets one-app diff report a missing selected artifact', async () => {
    const current = await createWorkspace({});
    const baseline = await createWorkspace({ alpha: 'alpha.baseline' });
    const input = wayfindDiffTrail.input.parse({
      againstRootDir: baseline,
      app: 'alpha',
      rootDir: current,
    });

    const result = await wayfindDiffTrail.implementation(input, {
      cwd: current,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(NotFoundError);
      expect(result.error.message).toContain(
        'No Wayfinder TopoGraph artifact found'
      );
      expect(result.error.message).not.toContain(
        'does not match its Config-owned identity'
      );
    }
  });

  test('rejects an app diff when the baseline lock names another app', async () => {
    const current = await createWorkspace({ alpha: 'alpha.current' });
    const baseline = await createWorkspace({ alpha: 'alpha.baseline' });
    await writeAppLock(baseline, 'alpha', 'other.baseline', 'other');
    const input = wayfindDiffTrail.input.parse({
      againstRootDir: baseline,
      app: 'alpha',
      rootDir: current,
    });

    const result = await wayfindDiffTrail.implementation(input, {
      cwd: current,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(
        'does not match its Config-owned identity'
      );
    }
  });

  test('rejects an against-dir artifact bound to another configured app', async () => {
    const current = await createWorkspace({
      alpha: 'alpha.current',
      beta: 'beta.baseline',
    });
    const input = wayfindDiffTrail.input.parse({
      againstDir: join(current, 'apps/beta'),
      app: 'alpha',
      rootDir: current,
    });

    const result = await wayfindDiffTrail.implementation(input, {
      cwd: current,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(
        'does not match its Config-owned identity'
      );
    }
  });

  test('diffs complete workspace views by stable app ID', async () => {
    const current = await createWorkspace({
      alpha: 'alpha.current',
      beta: 'beta.same',
    });
    const baseline = await createWorkspace({
      alpha: 'alpha.baseline',
      beta: 'beta.same',
    });
    const input = wayfindDiffTrail.input.parse({
      againstRootDir: baseline,
      rootDir: current,
    });

    const result = await wayfindDiffTrail.implementation(input, {
      cwd: current,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toMatchObject({
      against: {
        evidence: { configuredCompleteness: 'complete' },
        project: { selectedExtent: 'workspace' },
      },
      apps: [
        { appId: 'alpha', diff: { hasBreaking: true } },
        { appId: 'beta', diff: { hasBreaking: false } },
      ],
      current: { evidence: { configuredCompleteness: 'complete' } },
      project: { selectedExtent: 'workspace' },
    });
  });

  test('fails closed when either workspace diff view is partial', async () => {
    const current = await createWorkspace({
      alpha: 'alpha.current',
      beta: 'beta.current',
    });
    const baseline = await createWorkspace({ alpha: 'alpha.baseline' });
    const input = wayfindDiffTrail.input.parse({
      againstRootDir: baseline,
      rootDir: current,
    });

    const result = await wayfindDiffTrail.implementation(input, {
      cwd: current,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected partial workspace diff to fail.');
    }
    expect(result.error.message).toContain(
      'requires a complete baseline app-partitioned view'
    );
  });
});
