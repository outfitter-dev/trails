import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSkillset } from '../codex/skillset.ts';

const roots: string[] = [];
const interpolationToken = (name: string): string => ['${', name, '}'].join('');
const claudeProjectDirToken = interpolationToken('CLAUDE_PROJECT_DIR');
const pwdToken = interpolationToken('PWD');

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

const makeSkillsetRepo = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'skillset-test-'));
  roots.push(root);

  await mkdir(join(root, 'scripts/codex'), { recursive: true });
  await mkdir(join(root, '.claude/skills/demo'), { recursive: true });

  await writeFile(
    join(root, 'scripts/codex/skillset.config.toml'),
    [
      '[skillset]',
      'version = 1',
      '',
      '[paths]',
      'source = ".claude/skills"',
      'target = ".agents/skills"',
      '',
      '[frontmatter]',
      'remove = ["model"]',
      'preserve_removed_under = "metadata.skillset.source-frontmatter"',
      '',
      '[frontmatter.metadata.skillset]',
      'generator = "test-generator"',
      'target = "codex"',
      'version = 1',
      '',
      '[replacements]',
      `'${claudeProjectDirToken}' = '${pwdToken}'`,
      '',
      '[agents.clark]',
      'source_skill = "demo"',
      'target = ".codex/agents/clark.toml"',
      'name = "clark"',
      'description = "Clark test agent"',
      'model = "gpt-5.5"',
      'model_reasoning_effort = "xhigh"',
      'prepend = "prelude"',
      'append = "postlude"',
      '',
    ].join('\n')
  );

  await writeFile(
    join(root, '.claude/skills/demo/SKILL.md'),
    [
      '---',
      'name: demo',
      '# YAML comments should be ignored by the generated frontmatter parser.',
      'description: "Hello, \\"world\\""',
      'summary: "keeps # inside quotes" # drops this inline comment',
      'aliases: ["hello, world", "hash # value", plain, \'it\'\'s fine\'] # drops this too',
      'effort: max # only applies to claude',
      'model: opus',
      '---',
      '',
      `Body uses ${claudeProjectDirToken}.`,
      '',
    ].join('\n')
  );

  return root;
};

describe('skillset', () => {
  test('parses comments, escaped quoted strings, and quoted commas in frontmatter', async () => {
    const root = await makeSkillsetRepo();

    await runSkillset({ argv: [], cwd: root });

    const generated = await readFile(
      join(root, '.agents/skills/demo/SKILL.md'),
      'utf8'
    );

    expect(generated).toContain('description: "Hello, \\"world\\""');
    expect(generated).toContain('summary: "keeps # inside quotes"');
    expect(generated).toContain(
      'aliases: ["hello, world", "hash # value", plain, "it\'s fine"]'
    );
    expect(generated).toContain('effort: max');
    expect(generated).not.toContain('only applies to claude');
    expect(generated).not.toContain('drops this inline comment');
    expect(generated).toContain(`Body uses ${pwdToken}.`);
  });

  test('renders agents from source skills without requiring generated skills first', async () => {
    const root = await makeSkillsetRepo();

    await runSkillset({ argv: ['--only', 'agents'], cwd: root });

    const agent = await readFile(
      join(root, '.codex/agents/clark.toml'),
      'utf8'
    );
    await expect(
      stat(join(root, '.agents/skills/demo/SKILL.md'))
    ).rejects.toThrow();
    expect(agent).toContain('prelude');
    expect(agent).toContain(`Body uses ${pwdToken}.`);
    expect(agent).toContain('postlude');
  });
});
