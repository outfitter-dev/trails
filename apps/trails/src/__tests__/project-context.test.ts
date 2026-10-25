import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compileNeedsAppError,
  resolveOperatorAppModuleContext,
  resolveOperatorProjectContext,
} from '../trails/project-context.js';
import {
  operatorProjectContextOutput,
  operatorProjectContextOutputSchema,
} from '../trails/project-context-output.js';

const expectOk = <T>(
  result: Awaited<ReturnType<typeof resolveOperatorProjectContext>>
): T => {
  if (result.isErr()) {
    throw result.error;
  }
  expect(result.isOk()).toBe(true);
  return result.value as T;
};

const initGit = (root: string): void => {
  const result = Bun.spawnSync({
    cmd: ['git', 'init', '--quiet', root],
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (!result.success) {
    throw new Error(Buffer.from(result.stderr).toString('utf8'));
  }
};

const runGit = (cwd: string, args: readonly string[]): void => {
  const result = Bun.spawnSync({
    cmd: ['git', '-C', cwd, ...args],
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (!result.success) {
    throw new Error(Buffer.from(result.stderr).toString('utf8'));
  }
};

const writeWorkspace = (root: string): void => {
  mkdirSync(join(root, 'apps', 'alpha', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'beta', 'src'), { recursive: true });
  mkdirSync(join(root, 'shared'), { recursive: true });
  writeFileSync(join(root, 'apps', 'alpha', 'src', '.gitkeep'), '');
  writeFileSync(join(root, 'apps', 'beta', 'src', '.gitkeep'), '');
  writeFileSync(
    join(root, 'trails.config.ts'),
    `export default {
  workspace: {
    apps: {
      alpha: { root: 'apps/alpha' },
      beta: { entry: 'custom/topo.ts', root: 'apps/beta' },
    },
  },
};
`
  );
};

const writeWorkspaceConfigAt = (
  workspaceRoot: string,
  apps: Readonly<Record<string, string>>
): void => {
  const entries = Object.entries(apps);
  for (const [, appRoot] of entries) {
    mkdirSync(join(workspaceRoot, appRoot, 'src'), { recursive: true });
    writeFileSync(join(workspaceRoot, appRoot, 'src', '.gitkeep'), '');
  }
  const authoredApps = entries
    .map(([id, appRoot]) => `      ${id}: { root: '${appRoot}' },`)
    .join('\n');
  writeFileSync(
    join(workspaceRoot, 'trails.config.ts'),
    `export default {
  workspace: {
    apps: {
${authoredApps}
    },
  },
};
`
  );
};

const withUnavailableGit = async <T>(
  fixtureRoot: string,
  operation: () => Promise<T>
): Promise<T> => {
  const binDir = join(fixtureRoot, '.test-bin');
  mkdirSync(binDir, { recursive: true });
  const gitStub = join(binDir, 'git');
  writeFileSync(gitStub, '#!/bin/sh\nexit 127\n');
  chmodSync(gitStub, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = binDir;
  try {
    return await operation();
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
};

/** Exercise the fallback boundary walk with no Git binary and no .git marker. */
const withGitlessFixture = async (
  operation: (fixtureRoot: string) => Promise<void>
): Promise<void> => {
  const fixtureRoot = realpathSync(
    mkdtempSync(join(tmpdir(), 'trails-project-context-gitless-'))
  );
  try {
    await withUnavailableGit(fixtureRoot, () => operation(fixtureRoot));
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trails-project-context-'));
  initGit(root);
  writeWorkspace(root);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('resolveOperatorProjectContext', () => {
  test.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'selects an explicit descendant workspace from its parent (root=%s, absolute=%s)',
    async (explicitRoot, absolute) => {
      rmSync(join(root, 'trails.config.ts'));
      const workspaceRoot = join(root, 'custom');
      writeWorkspaceConfigAt(workspaceRoot, {
        alpha: 'apps/alpha',
        beta: 'apps/beta',
      });
      const configPath = absolute
        ? join(workspaceRoot, 'trails.config.ts')
        : 'custom/trails.config.ts';
      const input = { configPath, rootDir: explicitRoot ? root : undefined };
      const workspace = await resolveOperatorProjectContext(input, {
        cwd: root,
      });
      expect(workspace.isOk()).toBe(true);
      if (workspace.isErr()) {
        throw workspace.error;
      }
      expect(workspace.value).toMatchObject({
        boundaryDir: root,
        identity: {
          configPath: join(workspaceRoot, 'trails.config.ts'),
          rootDir: workspaceRoot,
        },
        projectRoot: workspaceRoot,
        selectedExtent: 'workspace',
        selectionProvenance: 'config-path',
      });
      const output = operatorProjectContextOutput(workspace.value);
      expect(operatorProjectContextOutputSchema.safeParse(output).success).toBe(
        true
      );
      expect(output).toMatchObject({
        configuredAppIds: ['alpha', 'beta'],
        selectionProvenance: 'config-path',
      });
      expect(
        compileNeedsAppError(workspace.value as never).context
      ).toMatchObject({ reason: 'compile-needs-app' });

      const app = await resolveOperatorProjectContext(
        { ...input, app: 'beta', module: 'custom/topo.ts' },
        { cwd: root }
      );
      expect(app.value).toMatchObject({
        app: { configured: true, id: 'beta', modulePath: 'custom/topo.ts' },
        projectRoot: workspaceRoot,
        selectionProvenance: 'app',
      });
      const unknown = await resolveOperatorProjectContext(
        { ...input, app: 'ghost' },
        { cwd: root }
      );
      expect(unknown.error?.context).toMatchObject({
        configuredAppIds: ['alpha', 'beta'],
        reason: 'unknown-app',
      });
      const module = await resolveOperatorProjectContext(
        { ...input, module: 'apps/alpha/src/app.ts' },
        { cwd: root }
      );
      expect(module.error?.context).toMatchObject({
        reason: 'invalid-binding',
      });
    }
  );

  test('does not use an explicit config to select a sibling workspace from unrelated CWD', async () => {
    rmSync(join(root, 'trails.config.ts'));
    writeWorkspaceConfigAt(join(root, 'custom'), { alpha: 'apps/alpha' });
    const result = await resolveOperatorProjectContext(
      { configPath: join(root, 'custom', 'trails.config.ts') },
      { cwd: join(root, 'shared') }
    );
    expect(result.error?.context).toMatchObject({ reason: 'outside-project' });
  });

  test.each(['custom.config.ts', 'absolute'])(
    'selects workspace identity from an explicit %s config path',
    async (pathKind) => {
      const configPath = join(root, 'custom.config.ts');
      renameSync(join(root, 'trails.config.ts'), configPath);
      const input = {
        configPath: pathKind === 'absolute' ? configPath : 'custom.config.ts',
      };

      const workspace = await resolveOperatorProjectContext(input, {
        cwd: root,
      });
      expect(workspace.isOk()).toBe(true);
      expect(workspace.value).toMatchObject({
        identity: { apps: [{ id: 'alpha' }, { id: 'beta' }], configPath },
        projectRoot: root,
        selectedExtent: 'workspace',
        selectionProvenance: 'cwd',
      });

      const app = await resolveOperatorProjectContext(
        { ...input, app: 'beta' },
        { cwd: root }
      );
      expect(app.isOk()).toBe(true);
      expect(app.value).toMatchObject({
        app: { id: 'beta', modulePath: 'custom/topo.ts' },
        selectedExtent: 'configured-app',
        selectionProvenance: 'app',
      });

      const withoutSelection = await resolveOperatorProjectContext(
        {},
        { cwd: root }
      );
      expect(withoutSelection.isOk()).toBe(true);
      expect(withoutSelection.value).toMatchObject({
        identity: { apps: [] },
        selectedExtent: 'standalone-app',
      });
    }
  );

  test.each(['relative', 'absolute'] as const)(
    'bases a %s config path at the owning workspace from nested CWD',
    async (pathKind) => {
      const configPath = join(root, 'trails.config.ts');
      const input = {
        configPath: pathKind === 'absolute' ? configPath : 'trails.config.ts',
      };
      const runtime = { cwd: join(root, 'apps', 'alpha', 'src') };
      const context = await resolveOperatorProjectContext(input, runtime);
      if (context.isErr()) {
        throw context.error;
      }
      expect(context.value).toMatchObject({
        app: { id: 'alpha' },
        identity: { configPath },
        projectRoot: root,
        selectedExtent: 'configured-app',
        selectionProvenance: 'cwd',
      });
      const explicitApp = await resolveOperatorProjectContext(
        { ...input, app: 'beta' },
        runtime
      );
      expect(explicitApp.isOk()).toBe(true);
      expect(explicitApp.value).toMatchObject({
        app: { id: 'beta', modulePath: 'custom/topo.ts' },
        projectRoot: root,
        selectedExtent: 'configured-app',
        selectionProvenance: 'app',
      });
    }
  );

  test.each(['relative', 'absolute', 'symlink'] as const)(
    'rejects a %s explicit config outside a nested Git collection',
    async (pathKind) => {
      const nestedRoot = join(root, 'apps', 'alpha');
      initGit(nestedRoot);
      const outerConfig = join(root, 'trails.config.ts');
      const configPath = {
        absolute: outerConfig,
        relative: '../../trails.config.ts',
        symlink: 'selected.config.ts',
      }[pathKind];
      if (pathKind === 'symlink') {
        symlinkSync(outerConfig, join(nestedRoot, configPath));
      }
      const result = await resolveOperatorProjectContext(
        { configPath },
        { cwd: nestedRoot }
      );
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('outside discovery boundary');
    }
  );

  test('keeps explicit config selection subject to overlapping workspace validation', async () => {
    writeWorkspaceConfigAt(join(root, 'apps', 'alpha'), {
      inner: 'apps/inner',
    });
    const result = await resolveOperatorProjectContext(
      { configPath: 'trails.config.ts' },
      { cwd: join(root, 'apps', 'alpha') }
    );
    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toContain(
      'Nested Trails workspaces are not supported'
    );
  });

  test('selects an explicit configured app from the workspace root', async () => {
    const context = expectOk<{
      readonly app: {
        readonly id: string;
        readonly modulePath: string;
        readonly moduleSource: string;
        readonly root: string;
      };
      readonly selectedExtent: string;
      readonly selectionProvenance: string;
    }>(await resolveOperatorProjectContext({ app: 'beta' }, { cwd: root }));

    expect(context).toMatchObject({
      app: {
        id: 'beta',
        modulePath: 'custom/topo.ts',
        moduleSource: 'config',
        root: 'apps/beta',
      },
      selectedExtent: 'configured-app',
      selectionProvenance: 'app',
    });
  });

  test('selects one app from nested CWD and keeps module overrides app-local', async () => {
    const context = expectOk<{
      readonly app: {
        readonly id: string;
        readonly modulePath: string;
        readonly moduleSource: string;
      };
      readonly selectedExtent: string;
      readonly selectionProvenance: string;
    }>(
      await resolveOperatorProjectContext(
        { module: 'src/alternate.ts' },
        { cwd: join(root, 'apps', 'alpha', 'src') }
      )
    );

    expect(context).toMatchObject({
      app: {
        id: 'alpha',
        modulePath: 'src/alternate.ts',
        moduleSource: 'module',
      },
      selectedExtent: 'configured-app',
      selectionProvenance: 'cwd',
    });
  });

  test('keeps configured workspace identity from nested CWD without Git metadata', async () => {
    rmSync(join(root, '.git'), { force: true, recursive: true });
    writeFileSync(join(root, 'apps', 'alpha', 'trails.lock'), '{}\n');

    const context = expectOk<{
      readonly app: { readonly configured: boolean; readonly id: string };
      readonly projectRoot: string;
      readonly selectedExtent: string;
      readonly selectionProvenance: string;
    }>(
      await resolveOperatorProjectContext(
        {},
        { cwd: join(root, 'apps', 'alpha', 'src') }
      )
    );

    expect(context).toMatchObject({
      app: { configured: true, id: 'alpha' },
      projectRoot: realpathSync(root),
      selectedExtent: 'configured-app',
      selectionProvenance: 'cwd',
    });
  });

  test('falls back to configured discovery when git is unavailable', async () => {
    await withUnavailableGit(root, async () => {
      const context = expectOk<{
        readonly app: { readonly id: string };
        readonly selectedExtent: string;
      }>(
        await resolveOperatorProjectContext(
          {},
          { cwd: join(root, 'apps', 'alpha', 'src') }
        )
      );

      expect(context).toMatchObject({
        app: { id: 'alpha' },
        selectedExtent: 'configured-app',
      });
    });
  });

  test.each(['directory', 'file'] as const)(
    'does not cross a nested Git %s marker when Git is unavailable',
    async (markerKind) => {
      const nestedRoot = join(root, 'nested-repository');
      const nestedCwd = join(nestedRoot, 'src');
      mkdirSync(nestedCwd, { recursive: true });
      writeFileSync(
        join(nestedRoot, 'trails.config.ts'),
        'export default {};\n'
      );
      if (markerKind === 'directory') {
        mkdirSync(join(nestedRoot, '.git'));
      } else {
        writeFileSync(join(nestedRoot, '.git'), 'gitdir: ../fixture.git\n');
      }

      await withUnavailableGit(nestedRoot, async () => {
        const context = expectOk<{
          readonly projectRoot: string;
          readonly selectedExtent: string;
        }>(await resolveOperatorProjectContext({}, { cwd: nestedCwd }));

        expect(context).toMatchObject({
          projectRoot: realpathSync(nestedRoot),
          selectedExtent: 'standalone-app',
        });
      });
    }
  );

  test('fails closed on nested workspaces without a Git marker', async () => {
    await withGitlessFixture(async (fixtureRoot) => {
      writeWorkspaceConfigAt(fixtureRoot, { outer: 'apps/outer' });
      const innerRoot = join(fixtureRoot, 'projects', 'inner');
      mkdirSync(innerRoot, { recursive: true });
      writeWorkspaceConfigAt(innerRoot, { alpha: 'apps/alpha' });

      const result = await resolveOperatorProjectContext(
        {},
        { cwd: join(innerRoot, 'apps', 'alpha', 'src') }
      );

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'Nested Trails workspaces are not supported'
      );
      expect(result.error?.message).toContain(`${fixtureRoot}, ${innerRoot}`);
    });
  });

  test('keeps one workspace selectable without a Git marker', async () => {
    await withGitlessFixture(async (fixtureRoot) => {
      writeWorkspaceConfigAt(fixtureRoot, { alpha: 'apps/alpha' });

      const context = expectOk<{
        readonly app: { readonly configured: boolean; readonly id: string };
        readonly boundaryDir: string;
        readonly projectRoot: string;
        readonly selectedExtent: string;
      }>(
        await resolveOperatorProjectContext(
          {},
          { cwd: join(fixtureRoot, 'apps', 'alpha', 'src') }
        )
      );

      expect(context).toMatchObject({
        app: { configured: true, id: 'alpha' },
        boundaryDir: fixtureRoot,
        projectRoot: fixtureRoot,
        selectedExtent: 'configured-app',
      });
    });
  });

  test('keeps a standalone source owner without a Git marker', async () => {
    await withGitlessFixture(async (fixtureRoot) => {
      writeFileSync(
        join(fixtureRoot, 'trails.config.ts'),
        'export default {};\n'
      );
      mkdirSync(join(fixtureRoot, 'src', 'trails'), { recursive: true });
      writeFileSync(join(fixtureRoot, 'src', 'app.ts'), 'export default {};\n');

      const context = expectOk<{
        readonly app: {
          readonly configured: boolean;
          readonly modulePath: string;
          readonly rootDir: string;
        };
        readonly projectRoot: string;
        readonly selectedExtent: string;
      }>(
        await resolveOperatorProjectContext(
          {},
          { cwd: join(fixtureRoot, 'src') }
        )
      );

      expect(context).toMatchObject({
        app: {
          configured: false,
          modulePath: 'src/app.ts',
          rootDir: fixtureRoot,
        },
        projectRoot: fixtureRoot,
        selectedExtent: 'standalone-app',
      });
    });
  });

  test.each(['trails.config.ts', 'selected.config.ts'] as const)(
    'bases %s at the standalone source owner from nested CWD',
    async (configPath) => {
      rmSync(join(root, 'trails.config.ts'));
      writeFileSync(join(root, configPath), 'export default {};\n');
      mkdirSync(join(root, 'src', 'trails'), { recursive: true });
      writeFileSync(join(root, 'src', 'app.ts'), 'export default {};\n');

      const context = await resolveOperatorProjectContext(
        { configPath },
        { cwd: join(root, 'src', 'trails') }
      );
      expect(context.isOk()).toBe(true);
      expect(context.value).toMatchObject({
        app: { configured: false, modulePath: 'src/app.ts', rootDir: root },
        identity: { configPath: join(root, configPath) },
        projectRoot: root,
        selectedExtent: 'standalone-app',
      });
    }
  );

  test('keeps a nested app root ahead of an ancestor non-workspace config', async () => {
    writeFileSync(
      join(root, 'trails.config.ts'),
      'export default { warden: { format: "human" } };\n'
    );
    const appRoot = join(root, 'apps', 'standalone');
    mkdirSync(join(appRoot, 'src', 'trails'), { recursive: true });
    writeFileSync(join(appRoot, 'src', 'app.ts'), 'export default {};\n');
    const canonicalAppRoot = realpathSync(appRoot);

    const context = expectOk<{
      readonly app: {
        readonly modulePath: string;
        readonly rootDir: string;
      };
      readonly projectRoot: string;
      readonly selectedExtent: string;
    }>(
      await resolveOperatorProjectContext(
        { module: './src/app.ts' },
        { cwd: appRoot }
      )
    );

    expect(context).toMatchObject({
      app: { modulePath: './src/app.ts', rootDir: canonicalAppRoot },
      projectRoot: canonicalAppRoot,
      selectedExtent: 'standalone-app',
    });
  });

  test.each(['lock', 'source'] as const)(
    'keeps a nested app root ahead of an ancestor %s marker',
    async (markerKind) => {
      rmSync(join(root, 'trails.config.ts'));
      if (markerKind === 'lock') {
        writeFileSync(join(root, 'trails.lock'), '{}\n');
      } else {
        mkdirSync(join(root, 'src', 'trails'), { recursive: true });
      }
      const appRoot = join(root, 'apps', 'standalone');
      mkdirSync(join(appRoot, 'src'), { recursive: true });
      writeFileSync(join(appRoot, 'src', 'app.ts'), 'export default {};\n');
      const canonicalAppRoot = realpathSync(appRoot);

      const context = expectOk<{
        readonly app: { readonly rootDir: string };
        readonly projectRoot: string;
        readonly selectedExtent: string;
      }>(await resolveOperatorProjectContext({}, { cwd: appRoot }));

      expect(context).toMatchObject({
        app: { rootDir: canonicalAppRoot },
        projectRoot: canonicalAppRoot,
        selectedExtent: 'standalone-app',
      });
    }
  );

  test('discovers the sole nested app module in a standalone project', async () => {
    rmSync(join(root, 'trails.config.ts'));
    writeFileSync(
      join(root, 'apps', 'alpha', 'src', 'app.ts'),
      'export default {};\n'
    );

    const context = expectOk(
      await resolveOperatorProjectContext({}, { cwd: root })
    );
    const discovered = expectOk<{
      readonly app: {
        readonly modulePath: string;
        readonly moduleSource: string;
      };
      readonly selectedExtent: string;
    }>(resolveOperatorAppModuleContext(context as never));

    expect(discovered).toMatchObject({
      app: {
        modulePath: 'apps/alpha/src/app.ts',
        moduleSource: 'convention',
      },
      selectedExtent: 'standalone-app',
    });
  });

  test.each(['src', 'src/trails'])(
    'keeps the owner of a standalone source marker from nested %s CWD',
    async (cwd) => {
      rmSync(join(root, 'trails.config.ts'));
      rmSync(join(root, 'apps'), { force: true, recursive: true });
      mkdirSync(join(root, 'src', 'trails'), { recursive: true });
      writeFileSync(join(root, 'src', 'app.ts'), 'export default {};\n');
      const canonicalRoot = realpathSync(root);

      const context = expectOk<{
        readonly app: {
          readonly modulePath: string;
          readonly rootDir: string;
        };
        readonly projectRoot: string;
      }>(await resolveOperatorProjectContext({}, { cwd: join(root, cwd) }));

      expect(context).toMatchObject({
        app: { modulePath: 'src/app.ts', rootDir: canonicalRoot },
        projectRoot: canonicalRoot,
      });
    }
  );

  test('preserves standalone ambiguity across nested app modules', async () => {
    rmSync(join(root, 'trails.config.ts'));
    writeFileSync(
      join(root, 'apps', 'alpha', 'src', 'app.ts'),
      'export default {};\n'
    );
    writeFileSync(
      join(root, 'apps', 'beta', 'src', 'app.ts'),
      'export default {};\n'
    );

    const context = expectOk(
      await resolveOperatorProjectContext({}, { cwd: root })
    );
    const result = resolveOperatorAppModuleContext(context as never);

    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toContain('apps/alpha/src/app.ts');
    expect(result.error?.message).toContain('apps/beta/src/app.ts');
    expect(result.error?.message).toContain('--module');
  });

  test('selects workspace extent only at the configured root', async () => {
    const context = expectOk<{
      readonly apps: readonly { readonly id: string }[];
      readonly selectedExtent: string;
      readonly selectionProvenance: string;
    }>(await resolveOperatorProjectContext({}, { cwd: root }));

    expect(context.selectedExtent).toBe('workspace');
    expect(context.selectionProvenance).toBe('cwd');
    expect(context.apps.map((app) => app.id)).toEqual(['alpha', 'beta']);
    expect(compileNeedsAppError(context as never).context).toMatchObject({
      configuredAppIds: ['alpha', 'beta'],
      reason: 'compile-needs-app',
    });
  });

  test('returns typed choices for an unknown app', async () => {
    const result = await resolveOperatorProjectContext(
      { app: 'ghost' },
      { cwd: root }
    );

    expect(result.isErr()).toBe(true);
    expect(result.error?.context).toMatchObject({
      configuredAppIds: ['alpha', 'beta'],
      reason: 'unknown-app',
      requestedAppId: 'ghost',
    });
  });

  test('does not let module selection downgrade workspace extent', async () => {
    const result = await resolveOperatorProjectContext(
      { module: 'apps/alpha/src/app.ts' },
      { cwd: root }
    );

    expect(result.isErr()).toBe(true);
    expect(result.error?.context).toMatchObject({ reason: 'invalid-binding' });
  });

  test('fails outside configured app roots instead of guessing', async () => {
    const result = await resolveOperatorProjectContext(
      {},
      { cwd: join(root, 'shared') }
    );

    expect(result.isErr()).toBe(true);
    expect(result.error?.context).toMatchObject({ reason: 'outside-project' });
  });

  test('an explicit nested root does not adopt config above its boundary', async () => {
    const appRoot = realpathSync(join(root, 'apps', 'alpha'));
    const context = expectOk<{
      readonly app: { readonly configured: boolean; readonly rootDir: string };
      readonly projectRoot: string;
      readonly selectedExtent: string;
      readonly selectionProvenance: string;
    }>(
      await resolveOperatorProjectContext({ rootDir: appRoot }, { cwd: root })
    );

    expect(context).toMatchObject({
      app: { configured: false, rootDir: appRoot },
      projectRoot: appRoot,
      selectedExtent: 'standalone-app',
      selectionProvenance: 'root-dir',
    });
  });

  test('resolves a relative explicit root against the runtime CWD', async () => {
    const appRoot = realpathSync(join(root, 'apps', 'alpha'));
    const context = expectOk<{
      readonly app: { readonly configured: boolean; readonly rootDir: string };
      readonly projectRoot: string;
      readonly selectionProvenance: string;
    }>(
      await resolveOperatorProjectContext(
        { rootDir: '..' },
        { cwd: join(appRoot, 'src') }
      )
    );

    expect(context).toMatchObject({
      app: { configured: false, rootDir: appRoot },
      projectRoot: appRoot,
      selectionProvenance: 'root-dir',
    });
  });

  test('an explicit workspace boundary still lets nested CWD select its configured app', async () => {
    const context = expectOk<{
      readonly app: { readonly id: string };
      readonly selectedExtent: string;
      readonly selectionProvenance: string;
    }>(
      await resolveOperatorProjectContext(
        { rootDir: root },
        { cwd: join(root, 'apps', 'alpha', 'src') }
      )
    );

    expect(context).toMatchObject({
      app: { id: 'alpha' },
      selectedExtent: 'configured-app',
      selectionProvenance: 'cwd',
    });
  });

  test('matches a symlinked nested CWD to a canonical explicit workspace boundary', async () => {
    const alias = `${root}-alias`;
    symlinkSync(root, alias, 'dir');

    try {
      const context = expectOk<{
        readonly app: { readonly id: string };
        readonly selectedExtent: string;
        readonly selectionProvenance: string;
      }>(
        await resolveOperatorProjectContext(
          { rootDir: realpathSync(root) },
          { cwd: join(alias, 'apps', 'alpha', 'src') }
        )
      );

      expect(context).toMatchObject({
        app: { id: 'alpha' },
        selectedExtent: 'configured-app',
        selectionProvenance: 'cwd',
      });
    } finally {
      rmSync(alias, { force: true });
    }
  });

  test('matches a canonical nested CWD to a symlinked explicit workspace boundary', async () => {
    const alias = `${root}-alias`;
    symlinkSync(root, alias, 'dir');

    try {
      const context = expectOk<{
        readonly app: { readonly id: string };
        readonly selectedExtent: string;
        readonly selectionProvenance: string;
      }>(
        await resolveOperatorProjectContext(
          { rootDir: alias },
          { cwd: join(realpathSync(root), 'apps', 'alpha', 'src') }
        )
      );

      expect(context).toMatchObject({
        app: { id: 'alpha' },
        selectedExtent: 'configured-app',
        selectionProvenance: 'cwd',
      });
    } finally {
      rmSync(alias, { force: true });
    }
  });

  test('uses the linked worktree as the project boundary', async () => {
    const linkedRoot = `${root}-linked`;
    runGit(root, ['add', '.']);
    runGit(root, [
      '-c',
      'user.name=Trails',
      '-c',
      'user.email=trails@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ]);
    runGit(root, [
      'worktree',
      'add',
      '--quiet',
      '-b',
      'fixture-linked',
      linkedRoot,
    ]);

    try {
      const context = expectOk<{
        readonly app: { readonly id: string; readonly rootDir: string };
        readonly boundaryDir: string;
        readonly projectRoot: string;
        readonly selectionProvenance: string;
      }>(
        await resolveOperatorProjectContext(
          {},
          { cwd: join(linkedRoot, 'apps', 'alpha', 'src') }
        )
      );
      const canonicalLinkedRoot = realpathSync(linkedRoot);

      expect(context).toMatchObject({
        app: {
          id: 'alpha',
          rootDir: join(canonicalLinkedRoot, 'apps', 'alpha'),
        },
        boundaryDir: canonicalLinkedRoot,
        projectRoot: canonicalLinkedRoot,
        selectionProvenance: 'cwd',
      });
    } finally {
      runGit(root, ['worktree', 'remove', '--force', linkedRoot]);
      rmSync(linkedRoot, { force: true, recursive: true });
    }
  });
});
