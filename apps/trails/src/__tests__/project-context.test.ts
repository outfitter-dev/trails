import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
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
