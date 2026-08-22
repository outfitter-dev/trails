import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
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

const collectionEdgeFixtures = [
  [
    'nested repository',
    'nested-repository',
    async (rootDir: string) => {
      await writeFile(rootDir, 'apps/demo/.git/HEAD', 'ref: refs/heads/main\n');
      await mkdir(join(rootDir, 'apps/demo/.git/objects'), {
        recursive: true,
      });
    },
  ],
  [
    'nested worktree',
    'nested-worktree',
    async (rootDir: string) => {
      await writeFile(rootDir, 'git-data/demo/HEAD', 'ref: refs/heads/main\n');
      await writeFile(
        rootDir,
        'apps/demo/.git',
        'gitdir: ../../git-data/demo\n'
      );
    },
  ],
  [
    'submodule',
    'submodule-boundary',
    async (rootDir: string) => {
      await writeFile(
        rootDir,
        '.gitmodules',
        '[submodule "demo"]\n\tpath = apps/demo\n\turl = ../demo\n'
      );
      await mkdir(join(rootDir, 'apps/demo'), { recursive: true });
    },
  ],
  [
    'malformed Git',
    'unreadable-git-boundary',
    async (rootDir: string) => {
      await writeFile(rootDir, 'apps/demo/.git', 'not a gitdir pointer\n');
    },
  ],
] as const;

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

  for (const [label, content] of [
    [
      'as const',
      "export default { workspace: { apps: { demo: { root: 'apps/demo' } } } } as const;\n",
    ],
    [
      'satisfies',
      "export default { workspace: { apps: { demo: { root: 'apps/demo' } } } } satisfies { workspace: { apps: Record<string, { root: string }> } };\n",
    ],
    [
      'parentheses',
      "export default ({ workspace: { apps: { demo: { root: 'apps/demo' } } } });\n",
    ],
    [
      'defineConfig as const',
      `import { defineConfig } from '@ontrails/config';
export default defineConfig({ workspace: { apps: { demo: { root: 'apps/demo' } } } }) as const;\n`,
    ],
    [
      'nested as const',
      "export default { workspace: { apps: { demo: { root: 'apps/demo' as const } } } };\n",
    ],
  ] as const) {
    test(`reads TypeScript identity wrapped with ${label}`, async () => {
      await withTempDir(async (rootDir) => {
        await writeFile(rootDir, 'trails.config.ts', content);

        const result = await readTrailsProjectIdentity({
          boundaryDir: rootDir,
          startDir: rootDir,
        });

        expect(result.apps[0]).toMatchObject({
          id: 'demo',
          root: 'apps/demo',
        });
      });
    });
  }

  test('does not let type wrappers launder dynamic identity', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.ts',
        'export default ({ workspace: { apps: getApps() } } as const);\n'
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('workspace.apps must use inline object literals');
    });
  });

  test('ignores flexible deployment properties before literal workspace identity', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.ts',
        `import { defineConfig } from '@ontrails/config';
const deployment = readDeployment();
const deploymentKey = process.env.DEPLOYMENT_KEY;
export default defineConfig({
  ...deployment,
  [deploymentKey]: readValue(),
  schema: buildSchema(),
  workspace: { apps: { demo: { root: 'apps/demo' } } },
});\n`
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps[0]).toMatchObject({
        id: 'demo',
        root: 'apps/demo',
      });
    });
  });

  test('rejects deployment expressions that could override literal workspace identity', async () => {
    for (const suffix of ['...deployment', '[deploymentKey]: readValue()']) {
      await withTempDir(async (rootDir) => {
        await writeFile(
          rootDir,
          'trails.config.ts',
          `export default {
  workspace: { apps: { demo: { root: 'apps/demo' } } },
  ${suffix},
};\n`
        );

        await expect(
          readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
        ).rejects.toThrow('could override workspace');
      });
    }
  });

  test('allows a statically unrelated computed deployment key after workspace', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.ts',
        `export default {
  workspace: { apps: { demo: { root: 'apps/demo' } } },
  ['deployment']: readDeployment(),
};\n`
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps[0]?.id).toBe('demo');
    });
  });

  test('rejects computed workspace identity when no direct property overrides it', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.ts',
        "export default { ['workspace']: { apps: { demo: { root: 'apps/demo' } } } };\n"
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('must use a direct workspace property');
    });
  });

  test.each([
    ['a spread', '...projectIdentity'],
    ['an unknown computed property', '[projectKey]: projectIdentity'],
  ])(
    'rejects %s when workspace identity is otherwise absent',
    async (_label, property) => {
      await withTempDir(async (rootDir) => {
        await writeFile(
          rootDir,
          'trails.config.ts',
          `const projectIdentity = readProjectIdentity();
const projectKey = process.env.PROJECT_KEY;
export default { ${property} };\n`
        );

        await expect(
          readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
        ).rejects.toThrow('could supply workspace');
      });
    }
  );

  test('accepts a statically unrelated computed template key without workspace identity', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.ts',
        'export default { [`deployment`]: readDeployment() };\n'
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps).toEqual([]);
    });
  });

  test('rejects duplicate explicit workspace properties', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.ts',
        `export default {
  workspace: { apps: { alpha: { root: 'apps/alpha' } } },
  workspace: { apps: { beta: { root: 'apps/beta' } } },
};\n`
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('declares "workspace" more than once');
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

  for (const [extension, content, duplicate] of [
    ['json', '{"workspace":{"apps":{}},"workspace":{"apps":{}}}', 'workspace'],
    ['jsonc', '{"workspace":{"apps":{},"apps":{}}}', 'apps'],
    [
      'yaml',
      'workspace:\n  apps:\n    demo:\n      root: apps/a\n      root: apps/b\n',
      'root',
    ],
  ] as const) {
    test(`rejects duplicate ${extension} ${duplicate} identity fields`, async () => {
      await withTempDir(async (rootDir) => {
        await writeFile(rootDir, `trails.config.${extension}`, content);

        await expect(
          readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
        ).rejects.toThrow('more than once');
      });
    });
  }

  for (const [extension, content] of [
    [
      'json',
      '{"deployment":{"region":"a"},"deployment":{"region":"b"},"workspace":{"apps":{"demo":{"root":"apps/demo"}}}}',
    ],
    [
      'yaml',
      'deployment:\n  region: a\ndeployment:\n  region: b\nworkspace:\n  apps:\n    demo:\n      root: apps/demo\n',
    ],
  ] as const) {
    test(`keeps duplicate unrelated ${extension} deployment keys outside identity proof`, async () => {
      await withTempDir(async (rootDir) => {
        await writeFile(rootDir, `trails.config.${extension}`, content);

        const result = await readTrailsProjectIdentity({
          boundaryDir: rootDir,
          startDir: rootDir,
        });

        expect(result.apps[0]?.id).toBe('demo');
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

  test('rejects an app root that escapes through a workspace symlink', async () => {
    await withTempDir(async (rootDir) => {
      const outside = await makeTempDir();
      try {
        await writeFile(outside, 'src/app.ts', 'export default {};\n');
        await mkdir(join(rootDir, 'apps'), { recursive: true });
        await symlink(outside, join(rootDir, 'apps', 'demo'), 'dir');
        await writeFile(
          rootDir,
          'trails.config.json',
          JSON.stringify({
            workspace: { apps: { demo: { root: 'apps/demo' } } },
          })
        );

        await expect(
          readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
        ).rejects.toThrow('outside the workspace trust boundary');
      } finally {
        await rm(outside, { force: true, recursive: true });
      }
    });
  });

  test('accepts an app root symlink that resolves inside the workspace', async () => {
    await withTempDir(async (rootDir) => {
      const internalRoot = join(rootDir, 'internal', 'demo');
      await writeFile(internalRoot, 'src/app.ts', 'export default {};\n');
      await mkdir(join(rootDir, 'apps'), { recursive: true });
      const linkedRoot = join(rootDir, 'apps', 'demo');
      await symlink(internalRoot, linkedRoot, 'dir');
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: { apps: { demo: { root: 'apps/demo' } } },
        })
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps[0]?.rootDir).toBe(linkedRoot);
      expect(result.apps[0]?.entryPath).toBe(join(linkedRoot, 'src', 'app.ts'));
    });
  });

  test('rejects an app entry that escapes through a symlink', async () => {
    await withTempDir(async (rootDir) => {
      const outside = await makeTempDir();
      try {
        const outsideEntry = await writeFile(
          outside,
          'app.ts',
          'export default {};\n'
        );
        await writeFile(rootDir, 'apps/demo/src/.keep', '');
        await symlink(
          outsideEntry,
          join(rootDir, 'apps', 'demo', 'src', 'app.ts'),
          'file'
        );
        await writeFile(
          rootDir,
          'trails.config.json',
          JSON.stringify({
            workspace: { apps: { demo: { root: 'apps/demo' } } },
          })
        );

        await expect(
          readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
        ).rejects.toThrow('outside its app root trust boundary');
      } finally {
        await rm(outside, { force: true, recursive: true });
      }
    });
  });

  test('accepts an app entry symlink that resolves inside its app root', async () => {
    await withTempDir(async (rootDir) => {
      const appRoot = join(rootDir, 'apps', 'demo');
      const internalEntry = await writeFile(
        appRoot,
        'internal/app.ts',
        'export default {};\n'
      );
      await mkdir(join(appRoot, 'src'), { recursive: true });
      const linkedEntry = join(appRoot, 'src', 'app.ts');
      await symlink(internalEntry, linkedEntry, 'file');
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: { apps: { demo: { root: 'apps/demo' } } },
        })
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps[0]?.entryPath).toBe(linkedEntry);
    });
  });

  for (const [
    label,
    expectedReason,
    arrangeBoundary,
  ] of collectionEdgeFixtures) {
    test(`rejects an app root that traverses a ${label} collection edge`, async () => {
      await withTempDir(async (rootDir) => {
        await arrangeBoundary(rootDir);
        await writeFile(
          rootDir,
          'trails.config.json',
          JSON.stringify({
            workspace: { apps: { demo: { root: 'apps/demo' } } },
          })
        );

        try {
          await readTrailsProjectIdentity({
            boundaryDir: rootDir,
            startDir: rootDir,
          });
          throw new Error(`Expected ${label} boundary to reject app root`);
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          expect((error as ValidationError).context).toMatchObject({
            appId: 'demo',
            boundaryReason: expectedReason,
            reason: 'invalid-path',
            root: 'apps/demo',
          });
        }
      });
    });

    test(`rejects implicit and explicit config discovery through a ${label} collection edge`, async () => {
      await withTempDir(async (rootDir) => {
        await arrangeBoundary(rootDir);
        const nestedRoot = join(rootDir, 'apps/demo');
        const nestedConfig = await writeFile(
          nestedRoot,
          'trails.config.json',
          JSON.stringify({
            workspace: { apps: { nested: { root: '.' } } },
          })
        );
        const selections = [
          { boundaryDir: rootDir, startDir: nestedRoot },
          {
            boundaryDir: rootDir,
            configPath: nestedConfig,
            startDir: rootDir,
          },
        ] as const;

        for (const selection of selections) {
          try {
            await readTrailsProjectIdentity(selection);
            throw new Error(`Expected ${label} discovery edge to reject`);
          } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            expect((error as ValidationError).context).toMatchObject({
              boundaryReason: expectedReason,
            });
          }
        }
      });
    });
  }

  test('rejects an app root below a nested boundary in a config-ignored directory', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'node_modules/vendor/.git/HEAD',
        'ref: refs/heads/main\n'
      );
      await mkdir(join(rootDir, 'node_modules/vendor/.git/objects'), {
        recursive: true,
      });
      await writeFile(
        rootDir,
        'node_modules/vendor/apps/demo/src/app.ts',
        'export {}\n'
      );
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: {
            apps: { demo: { root: 'node_modules/vendor/apps/demo' } },
          },
        })
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('traverses a nested-repository collection edge');
    });
  });

  test('accepts an app that contains a deeper unrelated collection boundary', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(rootDir, 'apps/demo/src/app.ts', 'export {}\n');
      await writeFile(
        rootDir,
        'apps/demo/vendor/.git/HEAD',
        'ref: refs/heads/main\n'
      );
      await mkdir(join(rootDir, 'apps/demo/vendor/.git/objects'), {
        recursive: true,
      });
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: { apps: { demo: { root: 'apps/demo' } } },
        })
      );

      const identity = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(identity.apps.map((app) => app.id)).toEqual(['demo']);
    });
  });

  test('rejects an app entry that traverses a deeper collection edge', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'apps/demo/vendor/nested/.git/HEAD',
        'ref: refs/heads/main\n'
      );
      await mkdir(join(rootDir, 'apps/demo/vendor/nested/.git/objects'), {
        recursive: true,
      });
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: {
            apps: {
              demo: {
                entry: 'vendor/nested/src/app.ts',
                root: 'apps/demo',
              },
            },
          },
        })
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('entry traverses a nested-repository collection edge');
    });
  });

  test('keeps a nested repository first-class when invoked as the boundary root', async () => {
    await withTempDir(async (rootDir) => {
      const nestedRoot = join(rootDir, 'nested');
      await writeFile(nestedRoot, '.git/HEAD', 'ref: refs/heads/main\n');
      await mkdir(join(nestedRoot, '.git/objects'), { recursive: true });
      const configPath = await writeFile(
        nestedRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { nested: { root: '.' } } } })
      );

      const identity = await readTrailsProjectIdentity({
        boundaryDir: nestedRoot,
        startDir: nestedRoot,
      });

      expect(identity.configPath).toBe(configPath);
      expect(identity.apps[0]).toMatchObject({
        id: 'nested',
        rootDir: nestedRoot,
      });
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

  test('canonicalizes trailing root separators before collision checks', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: {
            apps: {
              alpha: { root: 'apps/a' },
              beta: { root: './apps/a//' },
            },
          },
        })
      );

      await expect(
        readTrailsProjectIdentity({ boundaryDir: rootDir, startDir: rootDir })
      ).rejects.toThrow('App roots must be unique');
    });

    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({
          workspace: { apps: { demo: { root: './apps/demo//' } } },
        })
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(result.apps[0]?.root).toBe('apps/demo');
    });
  });

  for (const [extension, content] of [
    [
      'json',
      '{"workspace":{"apps":{"demo":{"root":"apps/a"},"demo":{"root":"apps/b"}}}}',
    ],
    [
      'jsonc',
      '{"workspace":{"apps":{"demo":{"root":"apps/a"},/* duplicate */"demo":{"root":"apps/b"}}}}',
    ],
    [
      'yaml',
      'workspace:\n  apps:\n    demo:\n      root: apps/a\n    demo:\n      root: apps/b\n',
    ],
    [
      'toml',
      '[workspace.apps.demo]\nroot = "apps/a"\n[workspace.apps.demo]\nroot = "apps/b"\n',
    ],
  ] as const) {
    test(`rejects duplicate ${extension} app IDs before identity collapses`, async () => {
      await withTempDir(async (rootDir) => {
        await writeFile(rootDir, `trails.config.${extension}`, content);

        try {
          await readTrailsProjectIdentity({
            boundaryDir: rootDir,
            startDir: rootDir,
          });
          throw new Error(`Expected duplicate ${extension} app ID to fail`);
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          expect((error as Error).message).toMatch(/more than once|parse/u);
        }
      });
    });
  }

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

  test('inventories an internal candidate config symlink for overlap proof', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );
      const nestedConfigTarget = await writeFile(
        rootDir,
        'apps/demo/nested-workspace.ts',
        `export default { workspace: { apps: { nested: { root: 'nested' } } } };\n`
      );
      await symlink(
        nestedConfigTarget,
        join(rootDir, 'apps/demo/trails.config.ts'),
        'file'
      );

      await expect(
        readTrailsProjectIdentity({
          boundaryDir: rootDir,
          startDir: rootDir,
        })
      ).rejects.toThrow('Nested Trails workspaces are not supported');
    });
  });

  test('ignores dangling and directory-shaped candidate config aliases', async () => {
    await withTempDir(async (rootDir) => {
      const configPath = await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );
      await mkdir(join(rootDir, 'apps/demo'), { recursive: true });
      await symlink(
        join(rootDir, 'missing-config.ts'),
        join(rootDir, 'apps/demo/trails.config.ts'),
        'file'
      );
      await mkdir(join(rootDir, 'apps/demo/trails.config.mts'), {
        recursive: true,
      });

      const identity = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: rootDir,
      });

      expect(identity.configPath).toBe(configPath);
      expect(identity.apps.map((app) => app.id)).toEqual(['demo']);
    });
  });

  test('rejects a candidate config symlink whose target leaves the boundary', async () => {
    await withTempDir(async (rootDir) => {
      const outside = await makeTempDir();
      try {
        await writeFile(
          rootDir,
          'trails.config.json',
          JSON.stringify({
            workspace: { apps: { demo: { root: 'apps/demo' } } },
          })
        );
        const outsideConfig = await writeFile(
          outside,
          'nested-workspace.ts',
          `export default { workspace: { apps: { foreign: { root: '.' } } } };\n`
        );
        await mkdir(join(rootDir, 'apps/demo'), { recursive: true });
        await symlink(
          outsideConfig,
          join(rootDir, 'apps/demo/trails.config.ts'),
          'file'
        );

        await expect(
          readTrailsProjectIdentity({
            boundaryDir: rootDir,
            startDir: rootDir,
          })
        ).rejects.toThrow('resolves outside discovery boundary');
      } finally {
        await rm(outside, { force: true, recursive: true });
      }
    });
  });

  test('rejects a candidate config symlink targeting a nested collection edge', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );
      const foreignConfig = await writeFile(
        rootDir,
        'vendor/foreign/nested-workspace.ts',
        `export default { workspace: { apps: { foreign: { root: '.' } } } };\n`
      );
      await writeFile(
        rootDir,
        'vendor/foreign/.git/HEAD',
        'ref: refs/heads/main\n'
      );
      await mkdir(join(rootDir, 'vendor/foreign/.git/objects'), {
        recursive: true,
      });
      await mkdir(join(rootDir, 'apps/demo'), { recursive: true });
      await symlink(
        foreignConfig,
        join(rootDir, 'apps/demo/trails.config.ts'),
        'file'
      );

      await expect(
        readTrailsProjectIdentity({
          boundaryDir: rootDir,
          startDir: rootDir,
        })
      ).rejects.toThrow('traverses a nested-repository collection edge');
    });
  });

  test('fails closed when an explicit nested config declares another workspace', async () => {
    await withTempDir(async (rootDir) => {
      const appRoot = join(rootDir, 'apps', 'demo');
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );
      const nestedConfig = await writeFile(
        appRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { nested: { root: 'nested' } } } })
      );

      await expect(
        readTrailsProjectIdentity({
          boundaryDir: rootDir,
          configPath: nestedConfig,
          startDir: rootDir,
        })
      ).rejects.toThrow('Nested Trails workspaces are not supported');
    });
  });

  test('walks target ancestry for an explicit nested config alias', async () => {
    await withTempDir(async (rootDir) => {
      const appRoot = join(rootDir, 'apps', 'demo');
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );
      const nestedConfig = await writeFile(
        appRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { nested: { root: 'nested' } } } })
      );
      const linkedConfig = join(rootDir, 'aliases', 'trails.config.mts');
      await mkdir(dirname(linkedConfig), { recursive: true });
      await symlink(nestedConfig, linkedConfig, 'file');

      await expect(
        readTrailsProjectIdentity({
          boundaryDir: rootDir,
          configPath: linkedConfig,
          startDir: rootDir,
        })
      ).rejects.toThrow('Nested Trails workspaces are not supported');
    });
  });

  test('selects one workspace without rejecting a disjoint sibling', async () => {
    await withTempDir(async (collectionRoot) => {
      const alphaRoot = join(collectionRoot, 'alpha');
      const betaRoot = join(collectionRoot, 'beta');
      const alphaConfig = await writeFile(
        alphaRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { alpha: { root: 'app' } } } })
      );
      const betaConfig = await writeFile(
        betaRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { beta: { root: 'app' } } } })
      );

      const alpha = await readTrailsProjectIdentity({
        boundaryDir: collectionRoot,
        startDir: join(alphaRoot, 'app', 'src'),
      });
      expect(alpha.configPath).toBe(alphaConfig);
      expect(alpha.apps.map((app) => app.id)).toEqual(['alpha']);

      const beta = await readTrailsProjectIdentity({
        boundaryDir: collectionRoot,
        configPath: betaConfig,
        startDir: collectionRoot,
      });
      expect(beta.configPath).toBe(betaConfig);
      expect(beta.apps.map((app) => app.id)).toEqual(['beta']);
    });
  });

  test('does not parse a malformed disjoint sibling workspace', async () => {
    await withTempDir(async (collectionRoot) => {
      const alphaRoot = join(collectionRoot, 'alpha');
      const betaRoot = join(collectionRoot, 'beta');
      const alphaConfig = await writeFile(
        alphaRoot,
        'trails.config.ts',
        `export default { workspace: { apps: { alpha: { root: 'app' } } } };\n`
      );
      await writeFile(
        betaRoot,
        'trails.config.ts',
        'export default { workspace: { apps: readApps() } };\n'
      );

      const alpha = await readTrailsProjectIdentity({
        boundaryDir: collectionRoot,
        startDir: join(alphaRoot, 'app'),
      });
      const explicitAlpha = await readTrailsProjectIdentity({
        boundaryDir: collectionRoot,
        configPath: alphaConfig,
        startDir: collectionRoot,
      });
      const collection = await readTrailsProjectIdentity({
        boundaryDir: collectionRoot,
        startDir: collectionRoot,
      });

      expect(alpha.apps.map((app) => app.id)).toEqual(['alpha']);
      expect(explicitAlpha.apps.map((app) => app.id)).toEqual(['alpha']);
      expect(collection).toEqual({ apps: [], rootDir: collectionRoot });
    });
  });

  test('does not adopt a disjoint workspace from the collection root', async () => {
    await withTempDir(async (collectionRoot) => {
      await writeFile(
        join(collectionRoot, 'alpha'),
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { alpha: { root: 'app' } } } })
      );
      await writeFile(
        join(collectionRoot, 'beta'),
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { beta: { root: 'app' } } } })
      );

      const result = await readTrailsProjectIdentity({
        boundaryDir: collectionRoot,
        startDir: collectionRoot,
      });

      expect(result).toEqual({ apps: [], rootDir: collectionRoot });
    });
  });

  test('does not let a nested conflict in one sibling block another workspace', async () => {
    await withTempDir(async (collectionRoot) => {
      const alphaRoot = join(collectionRoot, 'alpha');
      const betaRoot = join(collectionRoot, 'beta');
      await writeFile(
        alphaRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { alpha: { root: 'app' } } } })
      );
      await writeFile(
        betaRoot,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { beta: { root: 'app' } } } })
      );
      await writeFile(
        join(betaRoot, 'app'),
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { nested: { root: 'nested' } } } })
      );

      const alpha = await readTrailsProjectIdentity({
        boundaryDir: collectionRoot,
        startDir: join(alphaRoot, 'app'),
      });
      expect(alpha.apps.map((app) => app.id)).toEqual(['alpha']);

      await expect(
        readTrailsProjectIdentity({
          boundaryDir: collectionRoot,
          startDir: join(betaRoot, 'app'),
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

  test('rejects a discovery start that escapes through a boundary symlink', async () => {
    await withTempDir(async (rootDir) => {
      const outside = await makeTempDir();
      try {
        await writeFile(
          outside,
          'trails.config.json',
          JSON.stringify({ workspace: { apps: { escaped: { root: 'app' } } } })
        );
        const linkedStart = join(rootDir, 'linked-outside');
        await symlink(outside, linkedStart, 'dir');

        await expect(
          readTrailsProjectIdentity({
            boundaryDir: rootDir,
            startDir: linkedStart,
          })
        ).rejects.toThrow('outside discovery boundary');
      } finally {
        await rm(outside, { force: true, recursive: true });
      }
    });
  });

  test('accepts a discovery start through a symlink that stays inside the boundary', async () => {
    await withTempDir(async (rootDir) => {
      await writeFile(
        rootDir,
        'trails.config.json',
        JSON.stringify({ workspace: { apps: { demo: { root: 'apps/demo' } } } })
      );
      const appRoot = join(rootDir, 'apps', 'demo');
      await mkdir(appRoot, { recursive: true });
      const linkedStart = join(rootDir, 'linked-demo');
      await symlink(appRoot, linkedStart, 'dir');

      const identity = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        startDir: linkedStart,
      });

      expect(identity.configPath).toBe(join(rootDir, 'trails.config.json'));
      expect(identity.apps.map((app) => app.id)).toEqual(['demo']);
    });
  });

  test('walks canonical workspace ancestry from an external alias into the boundary', async () => {
    await withTempDir(async (rootDir) => {
      const aliasRoot = await makeTempDir();
      try {
        await writeFile(
          rootDir,
          'trails.config.json',
          JSON.stringify({
            workspace: { apps: { demo: { root: 'apps/demo' } } },
          })
        );
        const appRoot = join(rootDir, 'apps', 'demo');
        await mkdir(appRoot, { recursive: true });
        const linkedStart = join(aliasRoot, 'linked-demo');
        await symlink(appRoot, linkedStart, 'dir');

        const identity = await readTrailsProjectIdentity({
          boundaryDir: rootDir,
          startDir: linkedStart,
        });

        expect(identity.configPath).toBe(join(rootDir, 'trails.config.json'));
        expect(identity.apps.map((app) => app.id)).toEqual(['demo']);
      } finally {
        await rm(aliasRoot, { force: true, recursive: true });
      }
    });
  });

  test('rejects an explicit config that escapes through a boundary symlink', async () => {
    await withTempDir(async (rootDir) => {
      const outside = await makeTempDir();
      try {
        const outsideConfig = await writeFile(
          outside,
          'trails.config.json',
          JSON.stringify({ workspace: { apps: {} } })
        );
        const linkedConfig = join(rootDir, 'linked-config.json');
        await symlink(outsideConfig, linkedConfig, 'file');

        await expect(
          readTrailsProjectIdentity({
            boundaryDir: rootDir,
            configPath: linkedConfig,
            startDir: rootDir,
          })
        ).rejects.toThrow('outside discovery boundary');
      } finally {
        await rm(outside, { force: true, recursive: true });
      }
    });
  });

  test('keeps an explicit internal config alias without treating it as a duplicate', async () => {
    await withTempDir(async (rootDir) => {
      const configPath = await writeFile(
        rootDir,
        'trails.config.ts',
        `export default { workspace: { apps: { demo: { root: 'apps/demo' } } } };`
      );
      const linkedConfig = join(rootDir, 'trails.config.mts');
      await symlink(configPath, linkedConfig, 'file');

      const identity = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        configPath: linkedConfig,
        startDir: rootDir,
      });

      expect(identity.configPath).toBe(linkedConfig);
      expect(identity.apps.map((app) => app.id)).toEqual(['demo']);
    });
  });

  test('resolves workspace roots from an aliased config target', async () => {
    await withTempDir(async (rootDir) => {
      const projectRoot = join(rootDir, 'project');
      const configPath = await writeFile(
        projectRoot,
        'trails.config.ts',
        `export default { workspace: { apps: { demo: { root: 'app' } } } };\n`
      );
      const linkedConfig = join(rootDir, 'aliases', 'trails.config.mts');
      await mkdir(dirname(linkedConfig), { recursive: true });
      await symlink(configPath, linkedConfig, 'file');

      const identity = await readTrailsProjectIdentity({
        boundaryDir: rootDir,
        configPath: linkedConfig,
        startDir: rootDir,
      });

      expect(identity.configPath).toBe(linkedConfig);
      expect(identity.rootDir).toBe(projectRoot);
      expect(identity.apps[0]).toMatchObject({
        entryPath: join(projectRoot, 'app', 'src', 'app.ts'),
        rootDir: join(projectRoot, 'app'),
      });
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
