import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { WardenGuideManifest } from '@ontrails/warden';

import {
  PLUGIN_SKILL_WARDEN_GUIDE_PATH,
  SKILL_WARDEN_GUIDE_PATHS,
  SKILLSET_SKILL_WARDEN_GUIDE_PATH,
  isSkillWardenGuideCurrent,
  renderSkillWardenGuide,
  syncSkillWardenGuides,
} from '../sync-skill-warden-guide.js';

const manifestFixture = {
  generatedFrom: {
    package: '@ontrails/warden',
    registries: ['wardenRules'],
    source: 'fixture',
  },
  kind: 'trails-warden-guide-manifest',
  ruleCount: 0,
  rules: [],
  version: 1,
} satisfies WardenGuideManifest;

describe('sync-skill-warden-guide', () => {
  test('renders deterministic repo skill guidance from the Warden manifest', () => {
    const guide = renderSkillWardenGuide();

    expect(SKILLSET_SKILL_WARDEN_GUIDE_PATH).toBe(
      '.skillset/skills/be-clark/references/warden-guide.md'
    );
    expect(PLUGIN_SKILL_WARDEN_GUIDE_PATH).toBe(
      'plugin/skills/trails/references/warden-guide.md'
    );
    expect(SKILL_WARDEN_GUIDE_PATHS).toHaveLength(2);
    expect(guide).toStartWith('# Warden Guidance For Trails Skills');
    expect(guide).toContain(
      '- Guide input command: `bun apps/trails/bin/trails.ts warden guide --agent-json`'
    );
    expect(guide).toMatch(/Rule count: \d+/);
    expect(guide).toContain('## Agent Instructions');
    expect(guide).toContain('Repo-tracked skills, agents, and plugin prompts');
    expect(guide).toContain('### Results');
    expect(guide).toContain('`no-throw-in-implementation`');
  });

  test('accepts exactly current generated content', () => {
    const guide = renderSkillWardenGuide();

    expect(isSkillWardenGuideCurrent(guide)).toBeTrue();
  });

  test('rejects stale generated content', () => {
    const guide = renderSkillWardenGuide();

    expect(
      isSkillWardenGuideCurrent(
        guide.replace(/Rule count: \d+/, 'Rule count: old')
      )
    ).toBeFalse();
  });

  test('writes canonical Skillset source and the separate plugin guide only', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'trails-warden-skill-'));
    await syncSkillWardenGuides({ manifest: manifestFixture, rootDir });
    const changedManifest = {
      ...manifestFixture,
      ruleCount: 1,
    } satisfies WardenGuideManifest;

    expect(
      await syncSkillWardenGuides({ manifest: changedManifest, rootDir })
    ).toEqual([
      SKILLSET_SKILL_WARDEN_GUIDE_PATH,
      PLUGIN_SKILL_WARDEN_GUIDE_PATH,
    ]);
    expect(
      await readFile(join(rootDir, SKILLSET_SKILL_WARDEN_GUIDE_PATH), 'utf8')
    ).toBe(renderSkillWardenGuide(changedManifest));
    expect(
      await Bun.file(
        join(rootDir, '.claude/skills/be-clark/references/warden-guide.md')
      ).exists()
    ).toBeFalse();
    expect(
      await Bun.file(
        join(rootDir, '.agents/skills/be-clark/references/warden-guide.md')
      ).exists()
    ).toBeFalse();
  });

  test('rejects stale canonical source in check mode', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'trails-warden-check-'));

    expect(
      syncSkillWardenGuides({ check: true, manifest: manifestFixture, rootDir })
    ).rejects.toThrow('Warden skill guidance is out of date.');
  });
});
