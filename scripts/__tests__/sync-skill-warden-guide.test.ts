import { describe, expect, test } from 'bun:test';

import {
  CLAUDE_SKILL_WARDEN_GUIDE_PATH,
  PLUGIN_SKILL_WARDEN_GUIDE_PATH,
  SKILL_WARDEN_GUIDE_PATHS,
  isSkillWardenGuideCurrent,
  renderSkillWardenGuide,
} from '../sync-skill-warden-guide.js';

describe('sync-skill-warden-guide', () => {
  test('renders deterministic repo skill guidance from the Warden manifest', () => {
    const guide = renderSkillWardenGuide();

    expect(CLAUDE_SKILL_WARDEN_GUIDE_PATH).toBe(
      '.claude/skills/clark/references/warden-guide.md'
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
});
