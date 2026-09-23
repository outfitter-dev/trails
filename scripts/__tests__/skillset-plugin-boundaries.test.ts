import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

interface CliResult {
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
  }[];
  readonly exitCode: number;
  readonly ok: boolean;
}

const repoRoot = join(import.meta.dir, '../..');
const skillsetBin = join(repoRoot, 'node_modules/.bin/skillset');

const rootSkills = [
  'ask-trails-crew',
  'be-clark',
  'be-lewis',
  'clark-decision',
  'clark-pathfinding',
  'clark-survey',
  'trails-goal-loop',
  'trails-local-review',
] as const;

const contributorSkills = [
  'building-trails',
  'regrade-loop',
  'tenets',
  'trails-adrs',
  'trails-derive-from-source',
  'trails-discriminate-union',
  'trails-dogfood-check',
  'trails-editorial',
  'trails-language-styleguide',
  'trails-primitive-parity',
  'trails-warden-advisory',
  'trails-writing-docs',
  'trails-writing-style',
  'trails-writing-voice',
] as const;

const adopterSkills = ['trails', 'trails-error-format'] as const;

const listDirectories = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
};

const listFiles = async (root: string, current = root): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(relative(root, path));
    }
  }
  return files.toSorted();
};

const parseFrontmatter = (source: string): Record<string, unknown> => {
  const match = /^---\n([\s\S]*?)\n---/.exec(source);
  if (!match) {
    throw new Error('expected YAML frontmatter');
  }
  const value = Bun.YAML.parse(match[1] ?? '');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected object frontmatter');
  }
  return value as Record<string, unknown>;
};

const expectPackageLinksToResolve = async (
  packageRoot: string
): Promise<void> => {
  const packageFiles = await listFiles(packageRoot);
  const markdownFiles = packageFiles.filter((path) => path.endsWith('.md'));
  const missing: string[] = [];

  for (const file of markdownFiles) {
    const absoluteFile = join(packageRoot, file);
    const source = await readFile(absoluteFile, 'utf8');
    const links = source.matchAll(
      /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
    );

    for (const match of links) {
      const [, rawTarget] = match;
      if (!rawTarget || /^(?:[a-z]+:|#|\/)/i.test(rawTarget)) {
        continue;
      }
      const target = decodeURIComponent(
        rawTarget.replaceAll(/^<|>$/g, '').split('#')[0] ?? ''
      );
      if (!target) {
        continue;
      }
      const normalizedTarget = target.replaceAll('\\', '/');
      const isBundledCompanion =
        normalizedTarget.endsWith('/SKILL.md') ||
        /(?:^|\/)(?:assets|examples|references|templates)\//.test(
          normalizedTarget
        );
      if (!isBundledCompanion) {
        continue;
      }
      try {
        await access(resolve(dirname(absoluteFile), target));
      } catch {
        missing.push(`${file} -> ${rawTarget}`);
      }
    }
  }

  expect(missing).toEqual([]);
};

let fixtureRoot = '';
let workspace = '';
const processEnv = (name: string): string | undefined => process.env[name];

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'trails-skillset-boundaries-'));
  workspace = join(fixtureRoot, 'workspace');
  const taskHome = join(fixtureRoot, 'home');
  const taskTmp = join(fixtureRoot, 'tmp');
  const xdgRoot = join(fixtureRoot, 'xdg');

  await Promise.all([
    mkdir(join(workspace, '.skillset'), { recursive: true }),
    mkdir(taskHome, { recursive: true }),
    mkdir(taskTmp, { recursive: true }),
    mkdir(xdgRoot, { recursive: true }),
  ]);
  await Promise.all([
    cp(
      join(repoRoot, '.skillset/agents'),
      join(workspace, '.skillset/agents'),
      { recursive: true }
    ),
    cp(
      join(repoRoot, '.skillset/skills'),
      join(workspace, '.skillset/skills'),
      { recursive: true }
    ),
    cp(
      join(repoRoot, '.skillset/plugins'),
      join(workspace, '.skillset/plugins'),
      { recursive: true }
    ),
    cp(join(repoRoot, 'skillset.yaml'), join(workspace, 'skillset.yaml')),
  ]);

  const process = Bun.spawn(
    [skillsetBin, 'build', '--yes', '--json', '--root', workspace],
    {
      cwd: workspace,
      env: {
        HOME: taskHome,
        LANG: processEnv('LANG'),
        LC_ALL: processEnv('LC_ALL'),
        PATH: processEnv('PATH'),
        TMPDIR: taskTmp,
        XDG_CACHE_HOME: join(xdgRoot, 'cache'),
        XDG_CONFIG_HOME: join(xdgRoot, 'config'),
        XDG_DATA_HOME: join(xdgRoot, 'data'),
        XDG_STATE_HOME: join(xdgRoot, 'state'),
      },
      stderr: 'pipe',
      stdout: 'pipe',
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    process.stdout.text(),
    process.stderr.text(),
  ]);
  const result = JSON.parse(stdout) as CliResult;
  if (exitCode !== 0 || !result.ok) {
    throw new Error(
      `cold Skillset build failed (${exitCode}): ${stdout}\n${stderr}`
    );
  }
}, 30_000);

afterAll(async () => {
  if (fixtureRoot) {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

describe('Skillset plugin ownership boundaries', () => {
  test('rejects missing links to bundled examples', async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), 'trails-plugin-links-'));
    try {
      await writeFile(
        join(packageRoot, 'README.md'),
        'See the [missing example](examples/missing.md).\n'
      );
      await expect(expectPackageLinksToResolve(packageRoot)).rejects.toThrow();
    } finally {
      await rm(packageRoot, { force: true, recursive: true });
    }
  });

  test('keeps one explicit canonical owner for every skill audience', async () => {
    expect(await listDirectories(join(repoRoot, '.skillset/skills'))).toEqual([
      ...rootSkills,
    ]);
    expect(
      await listDirectories(
        join(repoRoot, '.skillset/plugins/trails-dev/skills')
      )
    ).toEqual([...contributorSkills]);
    expect(
      await listDirectories(join(repoRoot, '.skillset/plugins/trails/skills'))
    ).toEqual([...adopterSkills]);
  });

  test('links Claude contributor discovery to canonical trails-dev source', async () => {
    for (const skill of contributorSkills) {
      const bridge = join(repoRoot, '.claude/skills', skill);
      const canonical = join(
        repoRoot,
        '.skillset/plugins/trails-dev/skills',
        skill
      );

      const bridgeStat = await lstat(bridge);
      expect(bridgeStat.isSymbolicLink()).toBe(true);
      expect(await readlink(bridge)).toBe(
        `../../.skillset/plugins/trails-dev/skills/${skill}`
      );
      expect(await realpath(bridge)).toBe(await realpath(canonical));

      const frontmatter = parseFrontmatter(
        await readFile(join(bridge, 'SKILL.md'), 'utf8')
      );
      expect(frontmatter.name).toBe(skill);
    }
  });

  test('builds cold Claude and portable packages with disjoint inventories', async () => {
    const packages = [
      { root: join(workspace, 'plugin-dev'), skills: contributorSkills },
      {
        root: join(workspace, 'plugins/trails-dev/agents'),
        skills: contributorSkills,
      },
      { root: join(workspace, 'plugin'), skills: adopterSkills },
      { root: join(workspace, 'plugins/trails/agents'), skills: adopterSkills },
    ] as const;

    for (const entry of packages) {
      expect(await listDirectories(join(entry.root, 'skills'))).toEqual([
        ...entry.skills,
      ]);
      for (const skill of entry.skills) {
        const frontmatter = parseFrontmatter(
          await readFile(join(entry.root, 'skills', skill, 'SKILL.md'), 'utf8')
        );
        expect(frontmatter.name).toBe(skill);
      }
      await expectPackageLinksToResolve(entry.root);
    }

    await Promise.all([
      access(join(workspace, 'plugin-dev/skills/trails-adrs/scripts/adr.ts')),
      access(
        join(workspace, 'plugin-dev/skills/trails-editorial/assets/SAMPLES.md')
      ),
      access(join(workspace, 'plugin/agents/trail-engineer.md')),
      access(join(workspace, 'plugin/hooks/hooks.json')),
      access(join(workspace, 'plugin/rules/lexicon.md')),
      access(
        join(workspace, 'plugin/skills/trails/references/getting-started.md')
      ),
      access(join(workspace, 'plugin/skills/trails/templates/trail.md')),
    ]);
  });

  test('routes representative contributor and adopter prompts to the intended workflow', async () => {
    const editorial = parseFrontmatter(
      await readFile(
        join(workspace, 'plugin-dev/skills/trails-editorial/SKILL.md'),
        'utf8'
      )
    );
    const trails = parseFrontmatter(
      await readFile(join(workspace, 'plugin/skills/trails/SKILL.md'), 'utf8')
    );

    expect(editorial.description).toContain('Draft or review Trails docs');
    expect(editorial.description).toContain('release notes');
    expect(trails.description).toContain('Build with the Trails framework');

    const adrs = await readFile(
      join(workspace, 'plugin-dev/skills/trails-adrs/SKILL.md'),
      'utf8'
    );
    expect(adrs).toContain('load the singular');
    expect(adrs).toContain('`trails-editorial`');
    for (const compatibilitySkill of [
      'trails-language-styleguide',
      'trails-writing-docs',
      'trails-writing-style',
      'trails-writing-voice',
    ]) {
      const compatibilityBody = await readFile(
        join(workspace, 'plugin-dev/skills', compatibilitySkill, 'SKILL.md'),
        'utf8'
      );
      expect(compatibilityBody).toContain(
        '[`trails-editorial`](../trails-editorial/SKILL.md)'
      );
    }

    const adopterPackageFiles = await listFiles(join(workspace, 'plugin'));
    const adopterGuidanceFiles = adopterPackageFiles.filter(
      (path) =>
        path === 'README.md' ||
        /^(?:agents|hooks|rules|skills)\/.+\.(?:json|md|sh)$/.test(path)
    );
    const adopterGuidance = await Promise.all(
      adopterGuidanceFiles.map(async (path) => ({
        body: await readFile(join(workspace, 'plugin', path), 'utf8'),
        path,
      }))
    );
    for (const { body, path } of adopterGuidance) {
      for (const contributorOnly of [
        '.changeset',
        '.skillset/',
        'bun apps/trails/bin/trails.ts',
        'bun run plugin:',
        'bun run skillset:',
        'bun run warden:',
        'docs/contributing',
        'docs/lexicon.md',
        'docs/tenets.md',
        'Graphite',
        'scripts/adr.ts',
        'trails-adrs',
        'trails-editorial',
      ]) {
        expect(body, `${path} contains ${contributorOnly}`).not.toContain(
          contributorOnly
        );
      }
    }

    for (const packageRoot of [
      join(workspace, 'plugin-dev'),
      join(workspace, 'plugins/trails-dev/agents'),
    ]) {
      for (const skill of contributorSkills) {
        const body = await readFile(
          join(packageRoot, 'skills', skill, 'SKILL.md'),
          'utf8'
        );
        for (const projectOnlySkill of [
          'ask-trails-crew',
          'be-clark',
          'be-lewis',
          'clark-survey',
        ]) {
          expect(
            body,
            `${skill} references project-only ${projectOnlySkill}`
          ).not.toContain(projectOnlySkill);
        }
      }

      expect(
        await readFile(join(packageRoot, 'skills/tenets/SKILL.md'), 'utf8')
      ).not.toContain('`clark` agent');
      expect(
        await readFile(
          join(packageRoot, 'skills/building-trails/SKILL.md'),
          'utf8'
        )
      ).not.toContain('through Clark');
      expect(
        await readFile(
          join(packageRoot, 'skills/trails-primitive-parity/SKILL.md'),
          'utf8'
        )
      ).not.toContain('compound test');
    }
  });
});
