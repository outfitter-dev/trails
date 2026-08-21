import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ValidationError } from '@ontrails/core';

import { loadTrailsConfigFileValue } from '../trails-config-file.js';
import { readTrailsProjectIdentity } from '../workspace-config.js';

const makeTempDir = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'trails-static-config-'));

const writeFile = async (
  rootDir: string,
  relativePath: string,
  content: string
): Promise<string> => {
  const filePath = join(rootDir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, content);
  return filePath;
};

const withTempDir = async (operation: (rootDir: string) => Promise<void>) => {
  const rootDir = await makeTempDir();
  try {
    await operation(rootDir);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
};

describe('readTrailsProjectIdentity', () => {
  test('requires the caller-owned collection boundary', async () => {
    await expect(
      readTrailsProjectIdentity(
        {} as Parameters<typeof readTrailsProjectIdentity>[0]
      )
    ).rejects.toThrow('requires an explicit collection boundaryDir');
  });

  test('reads direct-object TypeScript identity without executing the module', async () => {
    await withTempDir(async (rootDir) => {
      const sentinel = join(rootDir, 'executed');
      await writeFile(
        rootDir,
        'trails.config.ts',
        `await Bun.write(${JSON.stringify(sentinel)}, 'executed');\nexport default { workspace: { apps: { demo: { root: './apps/demo' } } } };\n`
      );
      await writeFile(rootDir, 'apps/demo/src/app.ts', 'export default {};\n');

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(await Bun.file(sentinel).exists()).toBe(false);
      expect(result.rootDir).toBe(rootDir);
      expect(result.apps).toEqual([
        {
          entry: 'src/app.ts',
          entryPath: join(rootDir, 'apps/demo/src/app.ts'),
          entrySource: 'convention',
          id: 'demo',
          modulePath: 'apps/demo/src/app.ts',
          root: 'apps/demo',
          rootDir: join(rootDir, 'apps/demo'),
        },
      ]);
    });
  });

  test('reads defineConfig identity and returns deterministic app order', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.ts',
        `import { defineConfig } from '@ontrails/config';
import { z } from 'zod';
export default defineConfig({
  schema: z.object({}),
  workspace: { apps: {
    zebra: { root: 'apps/zebra' },
    alpha: { root: 'apps/alpha', entry: './custom.ts' },
  } },
});\n`
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps.map((app) => app.id)).toEqual(['alpha', 'zebra']);
      expect(result.apps[0]).toEqual({
        entry: 'custom.ts',
        entryPath: join(rootDir, 'apps/alpha/custom.ts'),
        entrySource: 'explicit',
        id: 'alpha',
        modulePath: 'apps/alpha/custom.ts',
        root: 'apps/alpha',
        rootDir: join(rootDir, 'apps/alpha'),
      });
      expect(result.workspace).toEqual({
        apps: {
          alpha: { entry: 'custom.ts', root: 'apps/alpha' },
          zebra: { root: 'apps/zebra' },
        },
      });
    });
  });

  test('recognizes an aliased Config-owned defineConfig import', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.ts',
        `import { defineConfig as trailsConfig } from '@ontrails/config';
export default trailsConfig({ workspace: { apps: { demo: { root: 'apps/demo' } } } });\n`
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps[0]?.id).toBe('demo');
    });
  });

  test('rejects a local arbitrary function named defineConfig', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.ts',
        `const defineConfig = (value: unknown) => value;
export default defineConfig({ workspace: { apps: { demo: { root: 'apps/demo' } } } });\n`
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('imported from @ontrails/config');
    });
  });

  for (const [extension, content] of [
    [
      'json',
      JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } }),
    ],
    [
      'jsonc',
      '{ // static identity\n "workspace": { "apps": { "demo": { "root": "apps/demo" } } } }',
    ],
    ['yaml', 'workspace:\n  apps:\n    demo:\n      root: apps/demo\n'],
    ['toml', '[workspace.apps.demo]\nroot = "apps/demo"\n'],
  ] as const) {
    test(`reads ${extension} identity`, async () => {
      await withTempDir(async (rootDir) => {
        await writeFile(rootDir, `trails.config.${extension}`, content);

        const result = await readTrailsProjectIdentity({
          boundaryDir: rootDir,
          startDir: rootDir,
        });

        expect(result.apps[0]).toMatchObject({
          entry: 'src/app.ts',
          id: 'demo',
          modulePath: 'apps/demo/src/app.ts',
          root: 'apps/demo',
        });
      });
    });
  }

  test('rejects representative dynamic identity expressions actionably', async () => {
    for (const [label, workspace] of [
      ['spread', '{ apps: { ...apps } }'],
      [
        'computed key',
        "{ apps: { [process.env.APP_ID]: { root: 'apps/a' } } }",
      ],
      ['identifier', '{ apps: { demo: { root: appRoot } } }'],
      ['call', '{ apps: { demo: { root: readRoot() } } }'],
      [
        'conditional',
        "{ apps: process.env.CI ? { demo: { root: 'apps/a' } } : {} }",
      ],
    ] as const) {
      await withTempDir(async (rootDir) => {
        await writeFile(
          rootDir,
          'trails.config.ts',
          `export default { workspace: ${workspace} };\n`
        );

        try {
          await readTrailsProjectIdentity({
            boundaryDir: rootDir,
            startDir: rootDir,
          });
          throw new Error(`Expected ${label} identity to fail`);
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          expect((error as ValidationError).context).toMatchObject({
            reason: 'dynamic-expression',
            section: 'workspace.apps',
          });
          expect((error as Error).message).toMatch(/literal|computed|spreads/u);
        }
      });
    }
  });

  test('rejects paths that escape the workspace root', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: '../demo' } } } })
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('must not escape the project root');
    });
  });

  test('rejects drive-relative and URL-shaped roots portably', async () => {
    for (const appRoot of [
      'C:outside',
      './C:outside',
      'apps/../C:outside',
      'file:apps/demo',
      'https:apps/demo',
    ]) {
      await withTempDir(async (rootDir) => {
        await writeFile(
          rootDir,
          'trails.config.json',
          JSON.stringify({ workspace: { apps: { demo: { root: appRoot } } } })
        );

        await expect(
          readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
        ).rejects.toThrow('must stay relative to the project root');
      });
    }
  });

  test('preserves a workspace-root app as app-scoped identity', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { root: { root: './' } } } })
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps[0]).toMatchObject({
        id: 'root',
        modulePath: 'src/app.ts',
        root: '.',
        rootDir,
      });
    });
  });

  for (const [format, content] of [
    [
      'TypeScript',
      "export default { workspace: { apps: { '__proto__': { root: 'apps/prototype' } } } };\n",
    ],
    ['JSON', '{"workspace":{"apps":{"__proto__":{"root":"apps/prototype"}}}}'],
  ] as const) {
    test(`preserves __proto__ as an authored ${format} app ID`, async () => {
      await withTempDir(async (rootDir) => {
        const extension = format === 'TypeScript' ? 'ts' : 'json';
        await writeFile(rootDir, `trails.config.${extension}`, content);

        const result = await readTrailsProjectIdentity({
          boundaryDir: rootDir,
          startDir: rootDir,
        });

        expect(result.apps).toHaveLength(1);
        expect(result.apps[0]?.id).toBe('__proto__');
        expect(Object.hasOwn(result.workspace?.apps ?? {}, '__proto__')).toBe(
          true
        );
        expect(
          Reflect.get(result.workspace?.apps ?? {}, '__proto__').root
        ).toBe('apps/prototype');
      });
    });
  }

  test('rejects explicit entries that escape the configured app root', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: {
            apps: { demo: { entry: '../shared/app.ts', root: 'apps/demo' } },
          },
        })
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('must not escape the app root');
    });
  });

  test('rejects an explicit entry that names the app directory', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: { apps: { demo: { entry: './', root: 'apps/demo' } } },
        })
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('must name a module entry within the app root');
    });
  });

  test('rejects app roots that collide after normalization', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: {
            apps: {
              alpha: { root: 'apps/a' },
              beta: { root: 'apps/./a' },
            },
          },
        })
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('App roots must be unique');
    });
  });

  test('discovers the workspace config above a nested app lock', async () => {
    await withTempDir(async (rootDir) => {
      const appRoot = join(rootDir, 'apps', 'demo');
      const nested = join(appRoot, 'src', 'trails', 'feature');
      await mkdir(nested, { recursive: true });
      await writeFile(appRoot, 'trails.lock', '{}\n');
      const configPath = await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: nested,
      });

      expect(result.configPath).toBe(configPath);
      expect(result.rootDir).toBe(rootDir);
      expect(result.apps[0]?.rootDir).toBe(appRoot);
    });
  });

  test('walks past an ordinary nested app config to the owning workspace', async () => {
    await withTempDir(async (rootDir) => {
      const appRoot = join(rootDir, 'apps', 'demo');
      await writeFile(
        appRoot,
        'trails.config.ts',
        "export default { module: 'src/app.ts' };\n"
      );
      const workspaceConfig = await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: join(appRoot, 'src'),
      });

      expect(result.configPath).toBe(workspaceConfig);
      expect(result.apps.map((app) => app.id)).toEqual(['demo']);
    });
  });

  test('fails closed when nested configs both declare workspaces', async () => {
    await withTempDir(async (rootDir) => {
      const appRoot = join(rootDir, 'apps', 'demo');
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );
      await writeFile(
        appRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { nested: { root: 'nested' } } } })
      );

      await expect(
        readTrailsProjectIdentity({
          boundaryDir: rootDir,
          startDir: appRoot,
        })
      ).rejects.toThrow('Nested Trails workspaces are not supported');
    });
  });

  test('finds nested workspace conflicts when discovery starts at the boundary', async () => {
    await withTempDir(async (rootDir) => {
      const appRoot = join(rootDir, 'apps', 'demo');
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );
      await writeFile(
        appRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { nested: { root: 'nested' } } } })
      );

      await expect(
        readTrailsProjectIdentity({
          boundaryDir: rootDir,
          startDir: rootDir,
        })
      ).rejects.toThrow('Nested Trails workspaces are not supported');
    });
  });

  test('does not absorb a workspace inside a nested repository boundary', async () => {
    await withTempDir(async (rootDir) => {
      const nestedRoot = join(rootDir, 'vendor', 'nested');
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );
      await writeFile(nestedRoot, '.git/HEAD', 'ref: refs/heads/main\n');
      await mkdir(join(nestedRoot, '.git', 'objects'), { recursive: true });
      await writeFile(
        nestedRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { foreign: { root: 'app' } } } })
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps.map((app) => app.id)).toEqual(['demo']);
    });
  });

  test('enforces the supplied discovery boundary', async () => {
    await withTempDir(async (rootDir) => {
      const outside = await makeTempDir();
      try {
        const outsideConfig = await writeFile(
          outside,
          'trails.config.json',
          JSON.stringify({ workspace: { apps: {} } })
        );

        await expect(
          readTrailsProjectIdentity({
            boundaryDir: rootDir,
            configPath: outsideConfig,
            startDir: rootDir,
          })
        ).rejects.toThrow('outside discovery boundary');
      } finally {
        await rm(outside, { force: true, recursive: true });
      }
    });
  });

  test('keeps runtime module loading compatible and separate', async () => {
    await withTempDir(async (rootDir) => {
      const sentinel = join(rootDir, 'executed');
      const configPath = await writeFile(
        rootDir,
        'trails.config.ts',
        `await Bun.write(${JSON.stringify(sentinel)}, 'executed');\nexport default { workspace: { apps: { demo: { root: 'apps/demo' } } } };\n`
      );

      const loaded = await loadTrailsConfigFileValue(configPath);

      expect(await Bun.file(sentinel).text()).toBe('executed');
      expect(loaded).toMatchObject({ workspace: { apps: { demo: {} } } });
    });
  });

  test('returns an empty identity result when no config exists', async () => {
    await withTempDir(async (rootDir) => {
      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).resolves.toEqual({ apps: [], rootDir });
    });
  });
});
