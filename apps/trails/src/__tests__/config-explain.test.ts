import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveCliCommands } from '@ontrails/cli';

import { app, trailsCliIncludedTrails, trailsOverlays } from '../app.js';
import { configExplainTrail } from '../trails/config-explain.js';

const initGit = (root: string): void => {
  const initialized = Bun.spawnSync({
    cmd: ['git', 'init', '--quiet', root],
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (!initialized.success) {
    throw new Error(Buffer.from(initialized.stderr).toString('utf8'));
  }
};

const writeWorkspace = (root: string, source?: string): void => {
  mkdirSync(join(root, 'apps', 'alpha', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'beta', 'custom'), { recursive: true });
  writeFileSync(
    join(root, 'trails.config.ts'),
    source ??
      `throw new Error('static project identity must not execute config modules');
export default {
  workspace: {
    apps: {
      beta: { entry: 'custom/topo.ts', root: 'apps/beta' },
      alpha: { root: 'apps/alpha' },
    },
  },
};
`
  );
  initGit(root);
};

const explain = async (
  input: { readonly app?: string; readonly rootDir?: string },
  cwd: string
) => {
  const result = await configExplainTrail.implementation(input, {
    cwd,
  } as never);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trails-config-explain-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('config.explain operator trail', () => {
  test('explains sorted static workspace identity without locks or app imports', async () => {
    writeWorkspace(root);
    const projectRoot = realpathSync(root);

    const value = await explain({}, root);

    expect(value.configPath).toBe(join(projectRoot, 'trails.config.ts'));
    expect(value.project).toMatchObject({
      apps: [
        {
          appId: 'alpha',
          appRoot: 'apps/alpha',
          configured: true,
          modulePath: 'src/app.ts',
          moduleSource: 'convention',
        },
        {
          appId: 'beta',
          appRoot: 'apps/beta',
          configured: true,
          modulePath: 'custom/topo.ts',
          moduleSource: 'config',
        },
      ],
      configuredAppIds: ['alpha', 'beta'],
      selectedExtent: 'workspace',
      selectionProvenance: 'cwd',
    });
    expect(existsSync(join(root, 'trails.lock'))).toBe(false);
    expect(existsSync(join(root, 'apps', 'alpha', 'trails.lock'))).toBe(false);
    expect(existsSync(join(root, 'apps', 'alpha', 'src', 'app.ts'))).toBe(
      false
    );
  });

  test('keeps explicit app and app-root CWD selection invariant', async () => {
    writeWorkspace(root);

    const explicit = await explain({ app: 'alpha' }, root);
    const inferred = await explain({}, join(root, 'apps', 'alpha'));

    expect(explicit.project).toMatchObject({
      app: { appId: 'alpha', appRoot: 'apps/alpha' },
      selectedExtent: 'configured-app',
      selectionProvenance: 'app',
    });
    expect(inferred.project).toMatchObject({
      app: { appId: 'alpha', appRoot: 'apps/alpha' },
      selectedExtent: 'configured-app',
      selectionProvenance: 'cwd',
    });
  });

  test('explains standalone identity without inventing workspace apps', async () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'trails.config.json'), '{}\n');
    initGit(root);
    const projectRoot = realpathSync(root);

    const value = await explain({}, root);

    expect(value).toMatchObject({
      configPath: join(projectRoot, 'trails.config.json'),
      project: {
        app: { appRoot: '.', configured: false },
        configuredAppIds: [],
        selectedExtent: 'standalone-app',
        selectionProvenance: 'cwd',
      },
    });
    expect('appId' in (value.project as { app: object }).app).toBe(false);
  });

  test('rejects unprovable workspace identity without executing the config module', async () => {
    const marker = join(root, 'executed.txt');
    writeWorkspace(
      root,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'executed');
const apps = { alpha: { root: 'apps/alpha' } };
export default { workspace: { apps } };
`
    );

    const result = await configExplainTrail.implementation({}, {
      cwd: root,
    } as never);

    expect(result.isErr()).toBe(true);
    expect(result.error?.context).toMatchObject({
      reason: 'dynamic-expression',
      section: 'workspace.apps',
    });
    expect(existsSync(marker)).toBe(false);
  });

  test('renders config explain with app and root-dir flags in CLI schema', () => {
    const commands = deriveCliCommands(app, {
      include: trailsCliIncludedTrails,
      overlays: trailsOverlays,
    });
    if (commands.isErr()) {
      throw commands.error;
    }
    const command = commands.value.find(
      (candidate) => candidate.path.join(' ') === 'config explain'
    );

    expect(command?.trail.id).toBe('config.explain');
    expect(command?.flags.map((flag) => flag.name)).toEqual(
      expect.arrayContaining(['app', 'root-dir'])
    );
  });
});
