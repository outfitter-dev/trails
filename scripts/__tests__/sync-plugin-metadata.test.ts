import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  checkPluginMetadata,
  readPluginMetadataState,
  syncPluginMetadata,
} from '../sync-plugin-metadata.js';

interface FixtureOptions {
  frameworkVersion?: string;
  marketplacePluginVersion?: string;
  pluginVersion?: string;
  renderedPluginVersion?: string;
  skillVersion?: string;
}

const renderJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

const renderSkill = (version: string): string => `---
name: trails
description: Build with the Trails framework.
metadata:
  trails: ${version}
---

# Trails
`;

const writeFixture = async (
  rootDir: string,
  options: FixtureOptions = {}
): Promise<void> => {
  const pluginVersion = options.pluginVersion ?? '0.3.0';
  const frameworkVersion = options.frameworkVersion ?? '1.0.0-beta.18';
  const marketplacePluginVersion =
    options.marketplacePluginVersion ?? pluginVersion;
  const renderedPluginVersion = options.renderedPluginVersion ?? pluginVersion;
  const skillVersion = options.skillVersion ?? frameworkVersion;

  await mkdir(join(rootDir, '.claude-plugin'), { recursive: true });
  await mkdir(join(rootDir, '.skillset/plugins/trails/skills/trails'), {
    recursive: true,
  });
  await mkdir(join(rootDir, 'plugin/.claude-plugin'), { recursive: true });
  await mkdir(join(rootDir, 'packages/core'), { recursive: true });

  await writeFile(
    join(rootDir, '.claude-plugin/marketplace.json'),
    renderJson({
      metadata: {
        description: 'Build with Trails.',
        version: '0.1.0',
      },
      name: 'trails',
      plugins: [
        {
          description: 'Trails plugin skills.',
          name: 'trails',
          source: './plugin',
          version: marketplacePluginVersion,
        },
      ],
    })
  );
  await writeFile(
    join(rootDir, 'plugin/.claude-plugin/plugin.json'),
    renderJson({
      description: 'Build with Trails.',
      name: 'trails',
      version: renderedPluginVersion,
    })
  );
  await writeFile(
    join(rootDir, '.skillset/plugins/trails/skills/trails/SKILL.md'),
    renderSkill(skillVersion)
  );
  await writeFile(
    join(rootDir, '.skillset/plugins/trails/skillset.yaml'),
    `skillset:\n  name: trails\n  version: ${pluginVersion}\n`
  );
  await writeFile(
    join(rootDir, 'packages/core/package.json'),
    renderJson({
      name: '@ontrails/core',
      version: frameworkVersion,
    })
  );
};

const withFixture = async <T>(
  options: FixtureOptions,
  fn: (rootDir: string) => Promise<T>
): Promise<T> => {
  const rootDir = await mkdtemp(join(tmpdir(), 'trails-plugin-metadata-'));
  try {
    await writeFixture(rootDir, options);
    return await fn(rootDir);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
};

describe('sync-plugin-metadata', () => {
  test('accepts independent plugin and framework versions', async () => {
    await withFixture({}, async (rootDir) => {
      const state = await readPluginMetadataState(rootDir);

      expect(state.pluginVersion).toBe('0.3.0');
      expect(state.frameworkVersion).toBe('1.0.0-beta.18');
      expect(checkPluginMetadata(state)).toEqual([]);
    });
  });

  test('also accepts equal plugin and framework versions', async () => {
    await withFixture(
      {
        frameworkVersion: '1.0.0-beta.18',
        pluginVersion: '1.0.0-beta.18',
      },
      async (rootDir) => {
        const state = await readPluginMetadataState(rootDir);

        expect(checkPluginMetadata(state)).toEqual([]);
      }
    );
  });

  test('reports every derived metadata drift independently', async () => {
    await withFixture(
      {
        marketplacePluginVersion: '0.2.0',
        renderedPluginVersion: '0.2.0',
        skillVersion: '1.0.0-beta.17',
      },
      async (rootDir) => {
        const diagnostics = checkPluginMetadata(
          await readPluginMetadataState(rootDir)
        );

        expect(diagnostics).toHaveLength(3);
        expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
          'plugin/.claude-plugin/plugin.json:version',
          '.claude-plugin/marketplace.json:plugins[trails].version',
          '.skillset/plugins/trails/skills/trails/SKILL.md:metadata.trails',
        ]);
        expect(diagnostics.map((diagnostic) => diagnostic.expected)).toEqual([
          '0.3.0',
          '0.3.0',
          '1.0.0-beta.18',
        ]);
      }
    );
  });

  test('sync updates only canonical skill metadata', async () => {
    await withFixture(
      {
        marketplacePluginVersion: '0.2.0',
        renderedPluginVersion: '0.2.0',
        skillVersion: '1.0.0-beta.17',
      },
      async (rootDir) => {
        const result = await syncPluginMetadata(rootDir);

        expect(result.changedPaths).toEqual([
          '.skillset/plugins/trails/skills/trails/SKILL.md',
        ]);
        expect(result.diagnostics).toEqual([]);
        expect(
          checkPluginMetadata(await readPluginMetadataState(rootDir))
        ).toHaveLength(2);

        const marketplace = JSON.parse(
          await readFile(
            join(rootDir, '.claude-plugin/marketplace.json'),
            'utf8'
          )
        );
        const skill = await readFile(
          join(rootDir, '.skillset/plugins/trails/skills/trails/SKILL.md'),
          'utf8'
        );

        expect(marketplace.metadata.version).toBe('0.1.0');
        expect(marketplace.plugins[0].version).toBe('0.2.0');
        expect(skill).toBe(renderSkill('1.0.0-beta.18'));
      }
    );
  });
});
