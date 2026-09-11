import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { planConsumerTransition } from '../consumer-zero-transition/plan.ts';
import {
  applyConsumerTransitionPlan,
  executeConsumerTransition,
} from '../consumer-zero-transition/run.ts';

const trailsRoot = resolve(import.meta.dir, '..', '..');
const roots: string[] = [];

const fixtureRoot = (manifest: object): string => {
  const root = mkdtempSync(join(tmpdir(), 'trails-consumer-0x-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('consumer 0.x transition', () => {
  test.each([
    { resolutions: { '**/@ontrails/core': '1.0.1' } },
    { overrides: { 'foo > @ontrails/core': '1.0.1' } },
    { overrides: { foo: { '**/@ontrails/core': '1.0.1' } } },
    { overrides: { foo: { alias: 'npm:@ontrails/core@1.0.1' } } },
  ])(
    'blocks unsupported Trails resolution selectors before writing',
    (fields) => {
      const root = fixtureRoot({
        ...fields,
        dependencies: { '@ontrails/core': '1.0.1' },
        name: 'selector-override',
      });
      const file = join(root, 'package.json');
      const before = readFileSync(file, 'utf8');
      let installs = 0;
      const result = executeConsumerTransition({
        apply: true,
        consumerRoot: root,
        install: true,
        installRunner: () => {
          installs += 1;
          return 0;
        },
        trailsRoot,
      });
      expect(result.code).toBe(1);
      expect(result.lines.join('\n')).toContain(
        'not supported by this transition bridge'
      );
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(installs).toBe(0);
    }
  );

  test('migrates flat npm alias overrides and resolutions', () => {
    const root = fixtureRoot({
      name: 'alias-override',
      overrides: { core: 'npm:@ontrails/core@1.0.1' },
      resolutions: { runtime: 'npm:@ontrails/core@^1.0.0-beta.50' },
    });
    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });
    expect(result.code).toBe(0);
    const manifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    );
    expect(manifest.overrides.core).toBe('npm:@ontrails/core@0.2.0');
    expect(manifest.resolutions.runtime).toBe('npm:@ontrails/core@^0.2.0');
  });

  test('previews exact dependency updates without writing the manifest', () => {
    const root = fixtureRoot({
      dependencies: {
        '@ontrails/core': '1.0.0-beta.46',
        zod: '^4.4.3',
      },
      devDependencies: {
        '@ontrails/testing': '1.0.1',
      },
      name: '@outfitter/example',
      private: true,
    });
    const before = readFileSync(join(root, 'package.json'), 'utf8');

    const plan = planConsumerTransition({ consumerRoot: root, trailsRoot });

    expect(plan.diagnostics).toEqual([]);
    expect(
      plan.changes.map(({ field, from, name, to }) => ({
        field,
        from,
        name,
        to,
      }))
    ).toEqual([
      {
        field: 'dependencies',
        from: '1.0.0-beta.46',
        name: '@ontrails/core',
        to: '0.2.0',
      },
      {
        field: 'devDependencies',
        from: '1.0.1',
        name: '@ontrails/testing',
        to: '0.2.0',
      },
    ]);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  test('updates caret ranges and removes beta tarball overrides', () => {
    const root = fixtureRoot({
      dependencies: {
        '@ontrails/core': '^1.0.0-beta.18',
      },
      name: 'radio',
      overrides: {
        '@ontrails/core':
          'file:/tmp/trails-deps/ontrails-core-1.0.0-beta.18.tgz',
        '@ontrails/observe':
          'file:/tmp/trails-deps/ontrails-observe-1.0.0-beta.18.tgz',
        zod: '^4.3.5',
      },
    });

    const plan = planConsumerTransition({ consumerRoot: root, trailsRoot });
    const [update] = plan.updates;

    expect(plan.diagnostics).toEqual([]);
    expect(plan.changes).toHaveLength(3);
    expect(update).toBeDefined();
    expect(JSON.parse(update?.after ?? '{}')).toMatchObject({
      dependencies: { '@ontrails/core': '^0.2.0' },
      overrides: { zod: '^4.3.5' },
    });
  });

  test('detaches external Trails workspaces and updates catalogs and members', () => {
    const root = fixtureRoot({
      catalog: { '@ontrails/core': '1.0.0-beta.19', zod: '^4.3.5' },
      name: 'consumer-workspace',
      private: true,
      workspaces: ['apps/*'],
    });
    const externalCore = join(trailsRoot, 'packages', 'core');
    const rootManifestPath = join(root, 'package.json');
    const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
    rootManifest.workspaces.push(relative(realpathSync(root), externalCore));
    writeFileSync(
      rootManifestPath,
      `${JSON.stringify(rootManifest, null, 2)}\n`
    );
    const appRoot = join(root, 'apps', 'demo');
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(
      join(appRoot, 'package.json'),
      `${JSON.stringify(
        {
          dependencies: { '@ontrails/core': 'workspace:^' },
          name: '@outfitter/demo',
          private: true,
        },
        null,
        2
      )}\n`
    );

    const plan = planConsumerTransition({ consumerRoot: root, trailsRoot });
    const canonicalRoot = realpathSync(root);
    const updates = new Map(
      plan.updates.map((update) => [
        relative(canonicalRoot, update.path),
        JSON.parse(update.after),
      ])
    );

    expect(plan.diagnostics).toEqual([]);
    expect(updates.get('package.json')).toMatchObject({
      catalog: { '@ontrails/core': '0.2.0', zod: '^4.3.5' },
      workspaces: ['apps/*'],
    });
    expect(updates.get('apps/demo/package.json')).toMatchObject({
      dependencies: { '@ontrails/core': '^0.2.0' },
    });
  });

  test('strips workspace protocol from a target range after exact external detachment', () => {
    const externalCore = join(trailsRoot, 'packages', 'core');
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': 'workspace:^0.2.0' },
      name: 'target-workspace-range',
      private: true,
      workspaces: [],
    });
    const rootPath = join(root, 'package.json');
    const manifest = JSON.parse(readFileSync(rootPath, 'utf8'));
    manifest.workspaces.push(relative(realpathSync(root), externalCore));
    writeFileSync(rootPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const externalPath = join(externalCore, 'package.json');
    const externalBefore = readFileSync(externalPath, 'utf8');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(rootPath, 'utf8'))).toMatchObject({
      dependencies: { '@ontrails/core': '^0.2.0' },
      workspaces: [],
    });
    expect(readFileSync(externalPath, 'utf8')).toBe(externalBefore);
  });

  test('blocks unsupported workspace ranges after exact external detachment', () => {
    const externalCore = join(trailsRoot, 'packages', 'core');
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': 'workspace:^1.0.2' },
      name: 'unsupported-workspace-range',
      private: true,
      workspaces: [],
    });
    const rootPath = join(root, 'package.json');
    const manifest = JSON.parse(readFileSync(rootPath, 'utf8'));
    manifest.workspaces.push(relative(realpathSync(root), externalCore));
    writeFileSync(rootPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const rootBefore = readFileSync(rootPath, 'utf8');
    const externalPath = join(externalCore, 'package.json');
    const externalBefore = readFileSync(externalPath, 'utf8');
    let installs = 0;

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: true,
      installRunner: () => {
        installs += 1;
        return 0;
      },
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'uses unsupported source workspace:^1.0.2'
    );
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
    expect(readFileSync(externalPath, 'utf8')).toBe(externalBefore);
    expect(installs).toBe(0);
  });

  test('updates npm aliases, named catalogs, and flat version overrides', () => {
    const root = fixtureRoot({
      catalogs: {
        trails: { '@ontrails/testing': '~1.0.0' },
      },
      dependencies: {
        'trails-core': 'npm:@ontrails/core@^1.0.0-beta.46',
      },
      name: '@outfitter/aliased',
      overrides: { '@ontrails/core': '1.0.1' },
    });

    const plan = planConsumerTransition({ consumerRoot: root, trailsRoot });
    const manifest = JSON.parse(plan.updates[0]?.after ?? '{}');

    expect(plan.diagnostics).toEqual([]);
    expect(manifest).toMatchObject({
      catalogs: { trails: { '@ontrails/testing': '~0.2.0' } },
      dependencies: {
        'trails-core': 'npm:@ontrails/core@^0.2.0',
      },
      overrides: { '@ontrails/core': '0.2.0' },
    });
  });

  test('blocks malformed root and named catalogs', () => {
    const root = fixtureRoot({
      catalog: '1.0.0-beta.19',
      catalogs: { trails: '1.0.0-beta.19' },
      dependencies: { '@ontrails/core': '1.0.0' },
      name: '@outfitter/malformed-catalogs',
    });
    const path = join(root, 'package.json');
    const before = readFileSync(path, 'utf8');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain('catalog must be an object');
    expect(result.lines.join('\n')).toContain(
      'catalogs.trails must be an object'
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  test('reports retired packages and unsupported sources without guessing', () => {
    const root = fixtureRoot({
      dependencies: {
        '@ontrails/core': 'latest',
        '@ontrails/observe': '1.0.0-beta.19',
      },
      name: '@outfitter/blocked',
    });

    const plan = planConsumerTransition({ consumerRoot: root, trailsRoot });

    expect(plan.changes).toEqual([]);
    expect(plan.diagnostics.map(({ name }) => name)).toEqual([
      '@ontrails/core',
      '@ontrails/observe',
    ]);
    expect(plan.diagnostics[0]?.message).toContain('unsupported source');
    expect(plan.diagnostics[1]?.message).toContain(
      'not in the current public Trails package set'
    );
  });

  test('writes only with apply and installs only when explicitly requested', () => {
    const previewRoot = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'preview',
    });
    const previewBefore = readFileSync(
      join(previewRoot, 'package.json'),
      'utf8'
    );
    let installs = 0;
    const install = () => {
      installs += 1;
      return 0;
    };

    const preview = executeConsumerTransition({
      apply: false,
      consumerRoot: previewRoot,
      install: false,
      installRunner: install,
      trailsRoot,
    });

    expect(preview.code).toBe(0);
    expect(readFileSync(join(previewRoot, 'package.json'), 'utf8')).toBe(
      previewBefore
    );
    expect(installs).toBe(0);

    const applyRoot = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'apply',
      packageManager: 'bun@1.3.10',
      scripts: { check: 'bun test' },
    });
    const applied = executeConsumerTransition({
      apply: true,
      consumerRoot: applyRoot,
      install: false,
      installRunner: install,
      trailsRoot,
    });

    expect(applied.code).toBe(0);
    expect(
      JSON.parse(readFileSync(join(applyRoot, 'package.json'), 'utf8'))
    ).toMatchObject({
      dependencies: { '@ontrails/core': '0.2.0' },
      packageManager: 'bun@1.3.10',
      scripts: { check: 'bun test' },
    });
    expect(installs).toBe(0);

    const installRoot = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.1' },
      name: 'install',
    });
    const installed = executeConsumerTransition({
      apply: true,
      consumerRoot: installRoot,
      install: true,
      installRunner: install,
      trailsRoot,
    });

    expect(installed.code).toBe(0);
    expect(installs).toBe(1);
  });

  test('repeated apply leaves bytes and modification time unchanged', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'repeat-apply',
    });
    const path = join(root, 'package.json');
    const first = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });
    const afterFirst = readFileSync(path, 'utf8');
    const mtimeAfterFirst = statSync(path).mtimeMs;

    const second = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(second.lines).toContain('No manifest changes needed.');
    expect(readFileSync(path, 'utf8')).toBe(afterFirst);
    expect(statSync(path).mtimeMs).toBe(mtimeAfterFirst);
  });

  test('runs an explicitly requested install when manifests need no changes', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '0.2.0' },
      name: 'install-current-manifest',
    });
    let installs = 0;

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: true,
      installRunner: () => {
        installs += 1;
        return 0;
      },
      trailsRoot,
    });

    expect(result.code).toBe(0);
    expect(installs).toBe(1);
    expect(result.lines).toContain(
      'No manifest changes needed. Ran `bun install` to update bun.lock.'
    );
  });

  test('does not reformat an unchanged workspace member or remove empty overrides', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'unchanged-member-root',
      overrides: {},
      private: true,
      workspaces: ['packages/*'],
    });
    const memberRoot = join(root, 'packages', 'member');
    mkdirSync(memberRoot, { recursive: true });
    const memberPath = join(memberRoot, 'package.json');
    const memberBefore =
      '{\n\t"name": "@outfitter/member",\n\t"dependencies": { "zod": "^4.4.3" }\n}\n';
    writeFileSync(memberPath, memberBefore);
    const memberMtime = statSync(memberPath).mtimeMs;

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(0);
    expect(readFileSync(memberPath, 'utf8')).toBe(memberBefore);
    expect(statSync(memberPath).mtimeMs).toBe(memberMtime);
    expect(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    ).toMatchObject({
      dependencies: { '@ontrails/core': '0.2.0' },
      overrides: {},
    });
  });

  test('refuses apply when a workspace glob reaches an external Trails package', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': 'workspace:^' },
      name: 'linked-consumer',
      private: true,
      workspaces: ['packages/*'],
    });
    const packages = join(root, 'packages');
    mkdirSync(packages);
    symlinkSync(join(trailsRoot, 'packages', 'core'), join(packages, 'core'));
    const before = readFileSync(join(root, 'package.json'), 'utf8');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'reached through a glob or ambiguous workspace entry'
    );
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  test('refuses install when exact and glob routes reach the same external package', () => {
    const externalCore = join(trailsRoot, 'packages', 'core');
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': 'workspace:^' },
      name: 'duplicate-external-routes',
      private: true,
      workspaces: ['packages/*'],
    });
    const rootPath = join(root, 'package.json');
    const manifest = JSON.parse(readFileSync(rootPath, 'utf8'));
    manifest.workspaces.push(relative(realpathSync(root), externalCore));
    writeFileSync(rootPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const packages = join(root, 'packages');
    mkdirSync(packages);
    symlinkSync(externalCore, join(packages, 'core'));
    const before = readFileSync(rootPath, 'utf8');
    let installs = 0;

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: true,
      installRunner: () => {
        installs += 1;
        return 0;
      },
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'reached through a glob or ambiguous workspace entry'
    );
    expect(readFileSync(rootPath, 'utf8')).toBe(before);
    expect(installs).toBe(0);
  });

  test('refuses install when an external directory glob overlaps an exact route', () => {
    const externalGroup = fixtureRoot({ name: 'external-group' });
    const externalCore = join(externalGroup, 'core');
    mkdirSync(externalCore);
    const externalPath = join(externalCore, 'package.json');
    writeFileSync(
      externalPath,
      `${JSON.stringify({
        dependencies: { zod: '^4.4.3' },
        name: '@ontrails/core',
      })}\n`
    );
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': 'workspace:^' },
      name: 'external-directory-glob',
      private: true,
      workspaces: [],
    });
    const rootPath = join(root, 'package.json');
    const manifest = JSON.parse(readFileSync(rootPath, 'utf8'));
    manifest.workspaces.push(
      `${relative(realpathSync(root), externalGroup)}/*`,
      relative(realpathSync(root), externalCore)
    );
    writeFileSync(rootPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const rootBefore = readFileSync(rootPath, 'utf8');
    const externalBefore = readFileSync(externalPath, 'utf8');
    let installs = 0;

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: true,
      installRunner: () => {
        installs += 1;
        return 0;
      },
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'reached through a glob or ambiguous workspace entry'
    );
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
    expect(readFileSync(externalPath, 'utf8')).toBe(externalBefore);
    expect(installs).toBe(0);
  });

  test('refuses install when a symlinked glob parent overlaps an exact route', () => {
    const externalGroup = fixtureRoot({ name: 'symlinked-external-group' });
    const externalCore = join(externalGroup, 'core');
    mkdirSync(externalCore);
    const externalPath = join(externalCore, 'package.json');
    writeFileSync(
      externalPath,
      `${JSON.stringify({
        dependencies: { zod: '^4.4.3' },
        name: '@ontrails/core',
      })}\n`
    );
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': 'workspace:^' },
      name: 'symlinked-parent-glob',
      private: true,
      workspaces: ['vendor/*'],
    });
    const rootPath = join(root, 'package.json');
    const manifest = JSON.parse(readFileSync(rootPath, 'utf8'));
    manifest.workspaces.push(relative(realpathSync(root), externalCore));
    writeFileSync(rootPath, `${JSON.stringify(manifest, null, 2)}\n`);
    symlinkSync(externalGroup, join(root, 'vendor'));
    const rootBefore = readFileSync(rootPath, 'utf8');
    const externalBefore = readFileSync(externalPath, 'utf8');
    let installs = 0;

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: true,
      installRunner: () => {
        installs += 1;
        return 0;
      },
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'reached through a glob or ambiguous workspace entry'
    );
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
    expect(readFileSync(externalPath, 'utf8')).toBe(externalBefore);
    expect(installs).toBe(0);
  });

  test('refuses install for an exact external non-Trails workspace', () => {
    const external = fixtureRoot({
      dependencies: { '@ontrails/testing': '1.0.1' },
      name: '@acme/shared',
    });
    const externalPath = join(external, 'package.json');
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.1' },
      name: 'external-shared-root',
      private: true,
      workspaces: [],
    });
    const rootPath = join(root, 'package.json');
    const manifest = JSON.parse(readFileSync(rootPath, 'utf8'));
    manifest.workspaces.push(relative(realpathSync(root), external));
    writeFileSync(rootPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const rootBefore = readFileSync(rootPath, 'utf8');
    const externalBefore = readFileSync(externalPath, 'utf8');
    let installs = 0;

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: true,
      installRunner: () => {
        installs += 1;
        return 0;
      },
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'migrate it separately or select a broader root before applying'
    );
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
    expect(readFileSync(externalPath, 'utf8')).toBe(externalBefore);
    expect(installs).toBe(0);
  });

  test('refuses install for an external non-Trails workspace under a glob symlink', () => {
    const external = fixtureRoot({
      dependencies: { '@ontrails/testing': '1.0.1' },
      name: '@acme/shared',
    });
    const externalPath = join(external, 'package.json');
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.1' },
      name: 'external-shared-glob-root',
      private: true,
      workspaces: ['packages/*'],
    });
    const packages = join(root, 'packages');
    mkdirSync(packages);
    symlinkSync(external, join(packages, 'shared'));
    const rootPath = join(root, 'package.json');
    const rootBefore = readFileSync(rootPath, 'utf8');
    const externalBefore = readFileSync(externalPath, 'utf8');
    let installs = 0;

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: true,
      installRunner: () => {
        installs += 1;
        return 0;
      },
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'migrate it separately or select a broader root before applying'
    );
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
    expect(readFileSync(externalPath, 'utf8')).toBe(externalBefore);
    expect(installs).toBe(0);
  });

  test('refuses install when a glob reaches an in-consumer workspace symlink', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'internal-symlink-root',
      private: true,
      workspaces: ['packages/*'],
    });
    const rootPath = join(root, 'package.json');
    const memberRoot = join(root, 'linked', 'member');
    mkdirSync(memberRoot, { recursive: true });
    const memberPath = join(memberRoot, 'package.json');
    writeFileSync(
      memberPath,
      `${JSON.stringify({
        dependencies: { '@ontrails/testing': '1.0.1' },
        name: '@outfitter/member',
      })}\n`
    );
    const packages = join(root, 'packages');
    mkdirSync(packages);
    symlinkSync(memberRoot, join(packages, 'member'));
    const rootBefore = readFileSync(rootPath, 'utf8');
    const memberBefore = readFileSync(memberPath, 'utf8');
    let installs = 0;

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: true,
      installRunner: () => {
        installs += 1;
        return 0;
      },
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'use its exact real path in workspaces before migration'
    );
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
    expect(readFileSync(memberPath, 'utf8')).toBe(memberBefore);
    expect(installs).toBe(0);
  });

  test('supports an exact in-consumer workspace symlink path', () => {
    const root = fixtureRoot({
      name: 'exact-internal-symlink-root',
      private: true,
      workspaces: ['packages/member'],
    });
    const memberRoot = join(root, 'linked', 'member');
    mkdirSync(memberRoot, { recursive: true });
    const memberPath = join(memberRoot, 'package.json');
    writeFileSync(
      memberPath,
      `${JSON.stringify({
        dependencies: { '@ontrails/testing': '1.0.1' },
        name: '@outfitter/member',
      })}\n`
    );
    const packages = join(root, 'packages');
    mkdirSync(packages);
    symlinkSync(memberRoot, join(packages, 'member'));

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(memberPath, 'utf8')).dependencies).toEqual({
      '@ontrails/testing': '0.2.0',
    });
  });

  test('keeps all manifests unchanged when any retired package blocks apply', () => {
    const root = fixtureRoot({
      dependencies: {
        '@ontrails/core': '1.0.0-beta.19',
        '@ontrails/observe': '1.0.0-beta.19',
      },
      name: 'retired-consumer',
    });
    const before = readFileSync(join(root, 'package.json'), 'utf8');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  test('blocks a retired dependency even when its beta tarball override is removable', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/observe': '1.0.0-beta.19' },
      name: 'retired-dependency-and-override',
      overrides: {
        '@ontrails/observe':
          'file:/tmp/trails-deps/ontrails-observe-1.0.0-beta.19.tgz',
      },
    });
    const path = join(root, 'package.json');
    const before = readFileSync(path, 'utf8');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.plan?.diagnostics.map(({ name }) => name)).toContain(
      '@ontrails/observe'
    );
    expect(result.plan?.changes).toContainEqual({
      field: 'overrides',
      file: realpathSync(path),
      from: 'file:/tmp/trails-deps/ontrails-observe-1.0.0-beta.19.tgz',
      kind: 'remove',
      name: '@ontrails/observe',
    });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  test('blocks nested overrides that contain a Trails declaration', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'nested-override',
      overrides: {
        foo: { '@ontrails/core': '1.0.0-beta.19' },
      },
    });
    const path = join(root, 'package.json');
    const before = readFileSync(path, 'utf8');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'Nested or non-string overrides.foo is not supported'
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  test('preflights every update before writing any manifest', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'preflight-workspace',
      private: true,
      workspaces: ['packages/*'],
    });
    const memberRoot = join(root, 'packages', 'member');
    mkdirSync(memberRoot, { recursive: true });
    const memberPath = join(memberRoot, 'package.json');
    writeFileSync(
      memberPath,
      `${JSON.stringify(
        {
          dependencies: { '@ontrails/testing': '1.0.1' },
          name: '@outfitter/member',
        },
        null,
        2
      )}\n`
    );
    const rootPath = join(root, 'package.json');
    const rootBefore = readFileSync(rootPath, 'utf8');
    const plan = planConsumerTransition({ consumerRoot: root, trailsRoot });
    writeFileSync(memberPath, `${readFileSync(memberPath, 'utf8')} `);

    const changedPath = applyConsumerTransitionPlan(plan);

    expect(changedPath).toBe(realpathSync(memberPath));
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
  });

  test('refuses a root manifest symlink that points outside the consumer', () => {
    const root = fixtureRoot({ name: 'temporary-root' });
    const outside = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'outside-root',
    });
    const rootPath = join(root, 'package.json');
    const outsidePath = join(outside, 'package.json');
    rmSync(rootPath);
    symlinkSync(outsidePath, rootPath);
    const outsideBefore = readFileSync(outsidePath, 'utf8');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'Refusing to read consumer manifest outside'
    );
    expect(readFileSync(outsidePath, 'utf8')).toBe(outsideBefore);
  });

  test('refuses a workspace manifest symlink that points outside the consumer', () => {
    const root = fixtureRoot({
      name: 'linked-member-root',
      private: true,
      workspaces: ['packages/*'],
    });
    const outside = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: '@outfitter/outside-member',
    });
    const memberRoot = join(root, 'packages', 'member');
    mkdirSync(memberRoot, { recursive: true });
    const outsidePath = join(outside, 'package.json');
    symlinkSync(outsidePath, join(memberRoot, 'package.json'));
    const outsideBefore = readFileSync(outsidePath, 'utf8');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'Workspace manifest resolves outside the selected consumer root'
    );
    expect(readFileSync(outsidePath, 'utf8')).toBe(outsideBefore);
  });

  test('refuses apply when a workspace member manifest is malformed', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'malformed-member-root',
      private: true,
      workspaces: ['packages/*'],
    });
    const rootPath = join(root, 'package.json');
    const rootBefore = readFileSync(rootPath, 'utf8');
    const memberRoot = join(root, 'packages', 'member');
    mkdirSync(memberRoot, { recursive: true });
    writeFileSync(join(memberRoot, 'package.json'), '{ malformed');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain('packages/member/package.json');
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
  });

  test('refuses unsupported workspace globs before writing any manifest', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'recursive-workspace-root',
      private: true,
      workspaces: ['packages/**'],
    });
    const rootPath = join(root, 'package.json');
    const rootBefore = readFileSync(rootPath, 'utf8');
    const memberRoot = join(root, 'packages', 'member');
    mkdirSync(memberRoot, { recursive: true });
    writeFileSync(
      join(memberRoot, 'package.json'),
      `${JSON.stringify({
        dependencies: { '@ontrails/testing': '1.0.1' },
        name: '@outfitter/member',
      })}\n`
    );

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'uses unsupported workspace pattern packages/**'
    );
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
  });

  test('refuses a workspace manifest without a string package name', () => {
    const root = fixtureRoot({
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'invalid-member-name-root',
      private: true,
      workspaces: ['packages/*'],
    });
    const rootPath = join(root, 'package.json');
    const rootBefore = readFileSync(rootPath, 'utf8');
    const memberRoot = join(root, 'packages', 'member');
    mkdirSync(memberRoot, { recursive: true });
    writeFileSync(
      join(memberRoot, 'package.json'),
      `${JSON.stringify({
        dependencies: { '@ontrails/testing': '1.0.1' },
        name: 42,
      })}\n`
    );

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(
      'must declare a string package name before migration'
    );
    expect(readFileSync(rootPath, 'utf8')).toBe(rootBefore);
  });

  test('refuses apply when the root manifest is malformed', () => {
    const root = fixtureRoot({ name: 'malformed-root' });
    const rootPath = join(root, 'package.json');
    writeFileSync(rootPath, '{ malformed');

    const result = executeConsumerTransition({
      apply: true,
      consumerRoot: root,
      install: false,
      trailsRoot,
    });

    expect(result.code).toBe(1);
    expect(result.lines.join('\n')).toContain(rootPath);
    expect(readFileSync(rootPath, 'utf8')).toBe('{ malformed');
  });
});
