import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

interface CliResult {
  readonly data?: Record<string, unknown>;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly path?: string;
  }[];
  readonly exitCode: number;
  readonly ok: boolean;
}

interface MarkdownDocument {
  readonly body: string;
  readonly frontmatter: Record<string, unknown>;
}

interface ParityFixture {
  readonly env: Record<string, string | undefined>;
  readonly root: string;
  readonly workspace: string;
}

interface SkillsetLock {
  readonly buildMode: string;
  readonly generatedBy: string;
  readonly items: readonly {
    readonly files: readonly string[];
    readonly kind: string;
    readonly name: string;
    readonly outputPath: string;
    readonly sourcePath: string;
  }[];
  readonly outputRoot: string;
  readonly schemaVersion: number;
  readonly selectedTargets: readonly string[];
  readonly sourceRoot: string;
  readonly target: string;
}

const repoRoot = join(import.meta.dir, '../..');
const skillsetBin = join(repoRoot, 'node_modules/.bin/skillset');
const fixtureRoots: string[] = [];

const parseMarkdown = (source: string): MarkdownDocument => {
  const normalized = source.replaceAll(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) {
    throw new Error('expected a Markdown document with YAML frontmatter');
  }

  const frontmatter = Bun.YAML.parse(match[1] ?? '');
  if (
    typeof frontmatter !== 'object' ||
    frontmatter === null ||
    Array.isArray(frontmatter)
  ) {
    throw new Error('expected frontmatter to parse as an object');
  }

  return {
    body: (match[2] ?? '').trimEnd(),
    frontmatter: frontmatter as Record<string, unknown>,
  };
};

const renderMarkdown = ({ body, frontmatter }: MarkdownDocument): string =>
  `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n${body.trimEnd()}\n`;

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('expected an object');
  }
  return value as Record<string, unknown>;
};

const normalizedLegacyFrontmatter = (
  value: Record<string, unknown>
): Record<string, unknown> => {
  const normalized = structuredClone(value);
  if (normalized.metadata !== undefined) {
    const metadata = asRecord(normalized.metadata);
    delete metadata.skillset;
    if (Object.keys(metadata).length === 0) {
      delete normalized.metadata;
    }
  }
  return normalized;
};

const normalizedStandaloneFrontmatter = (
  value: Record<string, unknown>,
  expected: Record<string, unknown>
): Record<string, unknown> => {
  const normalized = structuredClone(value);
  if (normalized.metadata !== undefined) {
    const metadata = asRecord(normalized.metadata);
    delete metadata.generated;
    if (metadata.skillset !== undefined) {
      const skillset = asRecord(metadata.skillset);
      delete skillset.generated;
      if (Object.keys(skillset).length === 0) {
        delete metadata.skillset;
      }
    }

    const expectedMetadata =
      expected.metadata === undefined ? undefined : asRecord(expected.metadata);
    if (expectedMetadata?.version === undefined) {
      delete metadata.version;
    }
    if (Object.keys(metadata).length === 0) {
      delete normalized.metadata;
    }
  }
  return normalized;
};

const listFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(relative(root, path));
      }
    }
  };

  await visit(root);
  return files.toSorted();
};

const fileMode = async (path: string): Promise<number> => {
  const status = await stat(path);
  return Number.parseInt(status.mode.toString(8).slice(-3), 8);
};

const generatedBy = 'skillset@0.1.0';

const expectGeneratedSkillMetadata = (
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
): void => {
  const actualMetadata = asRecord(actual.metadata);
  const expectedMetadata =
    expected.metadata === undefined ? undefined : asRecord(expected.metadata);
  expect(actualMetadata.generated).toBe(generatedBy);
  expect(actualMetadata.version).toBe(expectedMetadata?.version ?? '0.1.0');
};

const expectGeneratedAgentMetadata = (
  actual: Record<string, unknown>,
  kind: 'portable' | 'target-native'
): void => {
  if (kind === 'target-native') {
    expect(actual).not.toHaveProperty('metadata');
    return;
  }
  const metadata = asRecord(actual.metadata);
  expect(asRecord(metadata.skillset).generated).toBe(generatedBy);
};

const runCli = async (
  fixture: ParityFixture,
  args: readonly string[]
): Promise<CliResult> => {
  const process = Bun.spawn([skillsetBin, ...args], {
    cwd: fixture.workspace,
    env: fixture.env,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    process.stdout.text(),
    process.stderr.text(),
  ]);

  let result: CliResult;
  try {
    result = JSON.parse(stdout) as CliResult;
  } catch {
    throw new Error(
      `skillset emitted invalid JSON (process ${exitCode}): ${stdout}\n${stderr}`
    );
  }

  if (exitCode !== result.exitCode) {
    throw new Error(
      `skillset process exit ${exitCode} disagrees with JSON exitCode ${result.exitCode}: ${stdout}\n${stderr}`
    );
  }

  return result;
};

const requireCliSuccess = (result: CliResult): void => {
  if (!result.ok || result.exitCode !== 0) {
    const diagnostics = result.diagnostics
      .map(({ code, message, path }) =>
        [code, path, message].filter(Boolean).join(': ')
      )
      .join('\n');
    throw new Error(
      diagnostics.length > 0
        ? diagnostics
        : `skillset failed without diagnostics: ${JSON.stringify(result)}`
    );
  }
};

const makeAdaptiveAgentSource = async (
  name: 'clark' | 'lewis',
  includeClarkClaude = false
): Promise<string> => {
  const claude = parseMarkdown(
    await readFile(join(repoRoot, `.claude/agents/${name}.md`), 'utf8')
  );
  const codex = Bun.TOML.parse(
    await readFile(join(repoRoot, `.codex/agents/${name}.toml`), 'utf8')
  ) as Record<string, unknown>;

  return renderMarkdown({
    body: claude.body,
    frontmatter: {
      // Clark's Claude profile preloads the external `trails` skill, which is
      // intentionally outside this 16-skill source slice. Keep that complete
      // provider profile as a native island while proving the portable agent
      // renderer with Lewis and both Codex profiles.
      claude:
        name === 'clark' && !includeClarkClaude ? false : claude.frontmatter,
      codex,
      description: claude.frontmatter.description,
      name,
    },
  });
};

const makeClaudeOnlyAgentSource = async (
  name: 'maintainer'
): Promise<string> => {
  const claude = parseMarkdown(
    await readFile(join(repoRoot, `.claude/agents/${name}.md`), 'utf8')
  );
  return renderMarkdown({
    body: claude.body,
    frontmatter: {
      claude: claude.frontmatter,
      codex: false,
      description: claude.frontmatter.description,
      name,
    },
  });
};

const moveClaudeOnlySkillFields = async (
  workspace: string,
  skill: 'clark-decision' | 'clark-survey'
): Promise<void> => {
  const path = join(workspace, `.skillset/skills/${skill}/SKILL.md`);
  const document = parseMarkdown(await readFile(path, 'utf8'));
  const { agent, context } = document.frontmatter;

  expect(agent).toBe('clark');
  expect(context).toBe('fork');
  delete document.frontmatter.agent;
  delete document.frontmatter.context;
  document.frontmatter.claude = {
    frontmatter: { agent, context },
  };

  await writeFile(path, renderMarkdown(document));
};

const createBareFixture = async (
  prefix = 'trails-skillset-parity-'
): Promise<ParityFixture> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  fixtureRoots.push(root);

  const workspace = join(root, 'workspace');
  const home = join(root, 'home');
  const xdgConfig = join(root, 'xdg-config');
  const xdgCache = join(root, 'xdg-cache');
  const xdgData = join(root, 'xdg-data');
  const xdgState = join(root, 'xdg-state');
  const taskTmp = join(root, 'tmp');
  await Promise.all(
    [workspace, home, taskTmp, xdgConfig, xdgCache, xdgData, xdgState].map(
      (path) => mkdir(path, { recursive: true })
    )
  );

  const env: Record<string, string | undefined> = {
    HOME: home,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PATH: process.env.PATH,
    TMPDIR: taskTmp,
    XDG_CACHE_HOME: xdgCache,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    XDG_STATE_HOME: xdgState,
  };

  return {
    env,
    root,
    workspace,
  };
};

const initializeFixture = async (
  fixture: ParityFixture,
  extraArgs: readonly string[] = []
): Promise<CliResult> =>
  runCli(fixture, [
    'init',
    fixture.workspace,
    '--targets',
    'claude,codex',
    ...extraArgs,
    '--yes',
    '--json',
  ]);

const createFixture = async (): Promise<ParityFixture> => {
  const fixture = await createBareFixture();
  const { workspace } = fixture;

  requireCliSuccess(await initializeFixture(fixture));

  const importSource = join(workspace, 'import-source');
  await cp(join(repoRoot, '.claude/skills'), importSource, {
    recursive: true,
  });
  const importResult = await runCli(fixture, [
    'import',
    importSource,
    '--kind',
    'skills',
    '--from',
    'claude',
    '--root',
    workspace,
    '--json',
  ]);
  requireCliSuccess(importResult);

  const importReport = asRecord(asRecord(importResult.data).result);
  expect(importReport.files).toBe(39);
  expect((importReport.imports as unknown[]).length).toBe(16);

  await Promise.all([
    moveClaudeOnlySkillFields(workspace, 'clark-decision'),
    moveClaudeOnlySkillFields(workspace, 'clark-survey'),
  ]);

  await Promise.all(
    (['clark', 'lewis'] as const).map(async (name) => {
      const path = join(workspace, `.skillset/agents/${name}.md`);
      await writeFile(path, await makeAdaptiveAgentSource(name));
    })
  );
  await writeFile(
    join(workspace, '.skillset/agents/maintainer.md'),
    await makeClaudeOnlyAgentSource('maintainer')
  );

  await unlink(join(workspace, '.skillset/_claude/.gitkeep'));
  await unlink(join(workspace, '.skillset/_codex/.gitkeep'));
  const claudeAgentIsland = join(workspace, '.skillset/_claude/agents');
  await mkdir(claudeAgentIsland, { recursive: true });
  await cp(
    join(repoRoot, '.claude/agents/clark.md'),
    join(claudeAgentIsland, 'clark.md')
  );

  const manifestPath = join(workspace, 'skillset.yaml');
  const manifest = await readFile(manifestPath, 'utf8');
  await writeFile(
    manifestPath,
    manifest.replace(
      'compile:\n',
      'workspace:\n  cacheKey: trails-parity\ncompile:\n  build: all\n'
    )
  );

  requireCliSuccess(
    await runCli(fixture, ['build', '--yes', '--root', workspace, '--json'])
  );
  requireCliSuccess(
    await runCli(fixture, [
      'check',
      '--only',
      'outputs',
      '--root',
      workspace,
      '--json',
    ])
  );

  return fixture;
};

let fixture: ParityFixture;

beforeAll(async () => {
  fixture = await createFixture();
});

afterAll(async () => {
  await Promise.all(
    fixtureRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe('standalone Skillset parity', () => {
  test('reproduces the complete skill inventory, companions, and modes', async () => {
    const expectedFiles = await listFiles(join(repoRoot, '.claude/skills'));
    expect(expectedFiles).toHaveLength(39);
    expect(
      expectedFiles.filter((path) => path.endsWith('/SKILL.md'))
    ).toHaveLength(16);

    for (const outputRoot of ['.claude/skills', '.agents/skills']) {
      const absoluteOutputRoot = join(fixture.workspace, outputRoot);
      const managedFiles = await listFiles(absoluteOutputRoot);
      const outputFiles = managedFiles.filter(
        (path) => path !== 'skillset.lock'
      );
      expect(outputFiles).toEqual(expectedFiles);

      for (const path of outputFiles) {
        const canonicalMode = await fileMode(
          join(repoRoot, '.claude/skills', path)
        );
        expect(canonicalMode).toBe(0o644);
        expect(await fileMode(join(absoluteOutputRoot, path))).toBe(
          canonicalMode
        );
      }
    }

    for (const path of expectedFiles.filter(
      (candidate) => !candidate.endsWith('/SKILL.md')
    )) {
      const expected = await readFile(join(repoRoot, '.claude/skills', path));
      expect(
        await readFile(join(fixture.workspace, '.claude/skills', path))
      ).toEqual(expected);
      const codex = await readFile(
        join(fixture.workspace, '.agents/skills', path)
      );
      if (path.endsWith('/agents/openai.yaml')) {
        expect(Bun.YAML.parse(codex.toString())).toEqual(
          Bun.YAML.parse(expected.toString())
        );
      } else {
        expect(codex).toEqual(expected);
      }
    }
  });

  test('preserves skill bodies and provider-specific frontmatter semantics', async () => {
    const canonicalFiles = await listFiles(join(repoRoot, '.claude/skills'));
    const skillFiles = canonicalFiles.filter((path) =>
      path.endsWith('/SKILL.md')
    );

    for (const path of skillFiles) {
      const canonical = parseMarkdown(
        await readFile(join(repoRoot, '.claude/skills', path), 'utf8')
      );
      const legacy = parseMarkdown(
        await readFile(join(repoRoot, '.agents/skills', path), 'utf8')
      );
      const claude = parseMarkdown(
        await readFile(join(fixture.workspace, '.claude/skills', path), 'utf8')
      );
      const codex = parseMarkdown(
        await readFile(join(fixture.workspace, '.agents/skills', path), 'utf8')
      );

      expect(claude.body).toBe(canonical.body);
      expect(codex.body).toBe(legacy.body);
      expectGeneratedSkillMetadata(claude.frontmatter, canonical.frontmatter);
      expectGeneratedSkillMetadata(codex.frontmatter, canonical.frontmatter);
      expect(
        normalizedStandaloneFrontmatter(
          claude.frontmatter,
          canonical.frontmatter
        )
      ).toEqual(canonical.frontmatter);

      const expectedCodex = normalizedLegacyFrontmatter(legacy.frontmatter);
      expect(
        normalizedStandaloneFrontmatter(codex.frontmatter, expectedCodex)
      ).toEqual(expectedCodex);
    }

    for (const skill of ['clark-decision', 'clark-survey']) {
      const claude = parseMarkdown(
        await readFile(
          join(fixture.workspace, `.claude/skills/${skill}/SKILL.md`),
          'utf8'
        )
      );
      const codex = parseMarkdown(
        await readFile(
          join(fixture.workspace, `.agents/skills/${skill}/SKILL.md`),
          'utf8'
        )
      );
      expect(claude.frontmatter).toMatchObject({
        agent: 'clark',
        context: 'fork',
      });
      expect(codex.frontmatter).not.toHaveProperty('agent');
      expect(codex.frontmatter).not.toHaveProperty('context');
    }
  });

  test('renders Clark and Lewis with provider-native semantics', async () => {
    expect(await listFiles(join(fixture.workspace, '.claude/agents'))).toEqual([
      'clark.md',
      'lewis.md',
      'maintainer.md',
    ]);
    expect(await listFiles(join(fixture.workspace, '.codex/agents'))).toEqual([
      'clark.toml',
      'lewis.toml',
    ]);

    for (const name of ['clark', 'lewis'] as const) {
      const expectedClaude = parseMarkdown(
        await readFile(join(repoRoot, `.claude/agents/${name}.md`), 'utf8')
      );
      const actualClaude = parseMarkdown(
        await readFile(
          join(fixture.workspace, `.claude/agents/${name}.md`),
          'utf8'
        )
      );
      expect(actualClaude.body).toBe(expectedClaude.body);
      expectGeneratedAgentMetadata(
        actualClaude.frontmatter,
        name === 'clark' ? 'target-native' : 'portable'
      );
      const actualClaudeFrontmatter = normalizedStandaloneFrontmatter(
        actualClaude.frontmatter,
        expectedClaude.frontmatter
      );
      if (name === 'clark') {
        // 0.22.0 treats `model` as source-only even inside a target-native
        // Markdown island, so the island cannot preserve Clark's provider
        // alias. Keep this blocking difference explicit and fail on any other
        // semantic change.
        const expectedWithoutModel = structuredClone(
          expectedClaude.frontmatter
        );
        expect(expectedWithoutModel.model).toBe('fable');
        delete expectedWithoutModel.model;
        expect(actualClaudeFrontmatter).toEqual(expectedWithoutModel);
        expect(actualClaude.frontmatter).not.toHaveProperty('model');
      } else {
        expect(actualClaudeFrontmatter).toEqual(expectedClaude.frontmatter);
      }

      const expectedCodex = Bun.TOML.parse(
        await readFile(join(repoRoot, `.codex/agents/${name}.toml`), 'utf8')
      ) as Record<string, unknown>;
      const actualCodex = Bun.TOML.parse(
        await readFile(
          join(fixture.workspace, `.codex/agents/${name}.toml`),
          'utf8'
        )
      ) as Record<string, unknown>;
      expectGeneratedAgentMetadata(actualCodex, 'portable');
      delete actualCodex.metadata;
      expect(actualCodex.developer_instructions).toBeString();
      expect(expectedCodex.developer_instructions).toBeString();
      actualCodex.developer_instructions = (
        actualCodex.developer_instructions as string
      ).trim();
      expectedCodex.developer_instructions = (
        expectedCodex.developer_instructions as string
      ).trim();
      expect(actualCodex).toEqual(expectedCodex);
    }

    const expectedMaintainer = parseMarkdown(
      await readFile(join(repoRoot, '.claude/agents/maintainer.md'), 'utf8')
    );
    const actualMaintainer = parseMarkdown(
      await readFile(
        join(fixture.workspace, '.claude/agents/maintainer.md'),
        'utf8'
      )
    );
    expect(actualMaintainer.body).toBe(expectedMaintainer.body);
    expectGeneratedAgentMetadata(actualMaintainer.frontmatter, 'portable');
    expect(
      normalizedStandaloneFrontmatter(
        actualMaintainer.frontmatter,
        expectedMaintainer.frontmatter
      )
    ).toEqual(expectedMaintainer.frontmatter);
  });

  test('records complete managed-output provenance in locks', async () => {
    const expectedSkillFiles = await listFiles(
      join(repoRoot, '.claude/skills')
    );

    for (const outputRoot of ['.claude/skills', '.agents/skills']) {
      const lock = JSON.parse(
        await readFile(
          join(fixture.workspace, outputRoot, 'skillset.lock'),
          'utf8'
        )
      ) as SkillsetLock;
      expect(lock.generatedBy).toBe(generatedBy);
      expect(lock.buildMode).toBe('all');
      expect(lock.outputRoot).toBe(outputRoot);
      expect(lock.schemaVersion).toBe(1);
      expect(lock.selectedTargets).toEqual(['claude', 'codex']);
      expect(lock.sourceRoot).toBe('.skillset');
      expect(lock.target).toBe('workspace');
      expect(lock.items).toHaveLength(16);
      const skillNames = expectedSkillFiles
        .filter((path) => path.endsWith('/SKILL.md'))
        .map((path) => path.slice(0, -'/SKILL.md'.length));
      expect(
        lock.items.map(({ files, kind, name, outputPath, sourcePath }) => ({
          files,
          kind,
          name,
          outputPath,
          sourcePath,
        }))
      ).toEqual(
        skillNames.map((name) => ({
          files: expectedSkillFiles.filter((path) =>
            path.startsWith(`${name}/`)
          ),
          kind: 'standalone-skill',
          name,
          outputPath: `${name}/SKILL.md`,
          sourcePath: `.skillset/skills/${name}/SKILL.md`,
        }))
      );
    }

    const rootLock = JSON.parse(
      await readFile(join(fixture.workspace, 'skillset.lock'), 'utf8')
    ) as SkillsetLock;
    expect(rootLock.generatedBy).toBe(generatedBy);
    expect(rootLock.buildMode).toBe('all');
    expect(rootLock.outputRoot).toBe('.');
    expect(rootLock.schemaVersion).toBe(1);
    expect(rootLock.selectedTargets).toEqual(['claude', 'codex']);
    expect(rootLock.sourceRoot).toBe('.skillset');
    expect(rootLock.target).toBe('workspace');

    const ownership = rootLock.items.map(
      ({ files, kind, name, outputPath, sourcePath }) => ({
        files,
        kind,
        name,
        outputPath,
        sourcePath,
      })
    );
    expect(ownership).toEqual([
      {
        files: ['.claude/agents/clark.md'],
        kind: 'island',
        name: 'claude:project:agents/clark.md',
        outputPath: '.claude/agents/clark.md',
        sourcePath: '.skillset/_claude/agents/clark.md',
      },
      {
        files: ['.claude/agents/lewis.md'],
        kind: 'project-agent',
        name: 'lewis',
        outputPath: '.claude/agents/lewis.md',
        sourcePath: '.skillset/agents/lewis.md',
      },
      {
        files: ['.claude/agents/maintainer.md'],
        kind: 'project-agent',
        name: 'maintainer',
        outputPath: '.claude/agents/maintainer.md',
        sourcePath: '.skillset/agents/maintainer.md',
      },
      {
        files: ['.codex/agents/clark.toml'],
        kind: 'project-agent',
        name: 'clark',
        outputPath: '.codex/agents/clark.toml',
        sourcePath: '.skillset/agents/clark.md',
      },
      {
        files: ['.codex/agents/lewis.toml'],
        kind: 'project-agent',
        name: 'lewis',
        outputPath: '.codex/agents/lewis.toml',
        sourcePath: '.skillset/agents/lewis.md',
      },
    ]);
    expect(new Set(ownership.flatMap(({ files }) => files)).size).toBe(5);
  });

  test('keeps configured legacy replacements dormant', async () => {
    const canonicalFiles = await listFiles(join(repoRoot, '.claude/skills'));
    const sourceText = await Promise.all(
      canonicalFiles.map((path) =>
        readFile(join(repoRoot, '.claude/skills', path), 'utf8')
      )
    );
    const corpus = sourceText.join('\n');
    const dollar = String.fromCodePoint(36);

    for (const dormantSource of [
      `${dollar}{CLAUDE_PROJECT_DIR}`,
      '$CLAUDE_PROJECT_DIR',
      `${dollar}{CLAUDE_PLUGIN_ROOT}`,
      '$CLAUDE_PLUGIN_ROOT',
      `${dollar}{CLAUDECODE}`,
      '$CLAUDECODE',
      'read the matching `.agents/skills/<skill-name>/SKILL.md` symlink',
    ]) {
      expect(corpus).not.toContain(dormantSource);
    }
  });

  test('reproduces executable-mode loss and chmod-only drift blindness', async () => {
    const modeFixture = await createBareFixture('trails-skillset-mode-');
    requireCliSuccess(await initializeFixture(modeFixture));

    const importSource = join(modeFixture.workspace, 'mode-source');
    const companion = join(importSource, 'mode-probe/bin/probe.sh');
    await mkdir(join(importSource, 'mode-probe/bin'), { recursive: true });
    await writeFile(
      join(importSource, 'mode-probe/SKILL.md'),
      renderMarkdown({
        body: '# Mode probe',
        frontmatter: {
          description: 'Hermetic executable-mode parity probe.',
          name: 'mode-probe',
        },
      })
    );
    await writeFile(companion, '#!/bin/sh\nexit 0\n');
    await chmod(companion, 0o755);

    requireCliSuccess(
      await runCli(modeFixture, [
        'import',
        importSource,
        '--kind',
        'skills',
        '--from',
        'claude',
        '--root',
        modeFixture.workspace,
        '--json',
      ])
    );
    requireCliSuccess(
      await runCli(modeFixture, [
        'build',
        '--yes',
        '--root',
        modeFixture.workspace,
        '--json',
      ])
    );

    const output = join(
      modeFixture.workspace,
      '.claude/skills/mode-probe/bin/probe.sh'
    );
    expect(await fileMode(companion)).toBe(0o755);
    expect(await fileMode(output)).toBe(0o644);

    await chmod(output, 0o755);
    requireCliSuccess(
      await runCli(modeFixture, [
        'check',
        '--only',
        'outputs',
        '--root',
        modeFixture.workspace,
        '--json',
      ])
    );
  });

  test('reproduces unsafe mixed-root adoption and non-automatic agents', async () => {
    const adoptionFixture = await createBareFixture('trails-skillset-adopt-');
    await Promise.all([
      cp(
        join(repoRoot, '.agents/skills'),
        join(adoptionFixture.workspace, '.agents/skills'),
        { recursive: true }
      ),
      cp(
        join(repoRoot, '.claude/agents'),
        join(adoptionFixture.workspace, '.claude/agents'),
        { recursive: true }
      ),
      cp(
        join(repoRoot, '.claude/skills'),
        join(adoptionFixture.workspace, '.claude/skills'),
        { recursive: true }
      ),
    ]);

    const adoption = await initializeFixture(adoptionFixture, [
      '--adopt',
      'all',
    ]);
    expect(adoption.ok).toBe(false);
    expect(adoption.exitCode).not.toBe(0);
    const report = asRecord(asRecord(adoption.data).report);
    expect(report.candidates).toEqual([
      { kind: 'skills', path: '.agents/skills' },
      { kind: 'skills', path: '.claude/skills' },
    ]);
    expect(
      (
        report.imports as {
          readonly candidate: { readonly path: string };
          readonly ok: boolean;
        }[]
      ).map(({ candidate, ok }) => ({ ok, path: candidate.path }))
    ).toEqual([
      { ok: true, path: '.agents/skills' },
      { ok: false, path: '.claude/skills' },
    ]);
    expect(
      (
        report.surveySkips as {
          readonly path: string;
          readonly surface: string;
        }[]
      ).map(({ path, surface }) => ({ path, surface }))
    ).toContainEqual({ path: '.claude/agents', surface: 'agents' });

    const adoptedClarkDecision = parseMarkdown(
      await readFile(
        join(
          adoptionFixture.workspace,
          '.skillset/skills/clark-decision/SKILL.md'
        ),
        'utf8'
      )
    );
    expect(adoptedClarkDecision.frontmatter).not.toHaveProperty('agent');
    expect(adoptedClarkDecision.frontmatter).not.toHaveProperty('context');
    expect(
      asRecord(asRecord(adoptedClarkDecision.frontmatter.metadata).skillset)
        .generator
    ).toBe('scripts/codex/skillset.ts');
    expect(
      await listFiles(join(adoptionFixture.workspace, '.skillset/agents'))
    ).toEqual(['.gitkeep']);
  });

  test('reproduces Clark portable rejection before the lossy island fallback', async () => {
    const clarkFixture = await createBareFixture('trails-skillset-clark-');
    requireCliSuccess(await initializeFixture(clarkFixture));

    const importSource = join(clarkFixture.workspace, 'skill-source');
    await cp(join(repoRoot, '.claude/skills'), importSource, {
      recursive: true,
    });
    requireCliSuccess(
      await runCli(clarkFixture, [
        'import',
        importSource,
        '--kind',
        'skills',
        '--from',
        'claude',
        '--root',
        clarkFixture.workspace,
        '--json',
      ])
    );
    await writeFile(
      join(clarkFixture.workspace, '.skillset/agents/clark.md'),
      await makeAdaptiveAgentSource('clark', true)
    );

    const build = await runCli(clarkFixture, [
      'build',
      '--yes',
      '--root',
      clarkFixture.workspace,
      '--json',
    ]);
    expect(build.ok).toBe(false);
    expect(build.exitCode).not.toBe(0);
    expect(
      build.diagnostics.some(
        ({ message, path }) =>
          (path?.includes('.skillset/agents/clark.md') === true ||
            message.includes('.skillset/agents/clark.md')) &&
          message.includes('trails') &&
          message.includes('no matching standalone skill exists')
      )
    ).toBe(true);
  });

  test('detects target-side byte drift without touching live outputs', async () => {
    const output = join(
      fixture.workspace,
      '.agents/skills/building-trails/SKILL.md'
    );
    const original = await readFile(output);
    await writeFile(
      output,
      Buffer.concat([original, Buffer.from('\n<!-- drift -->\n')])
    );

    const drift = await runCli(fixture, [
      'check',
      '--only',
      'outputs',
      '--root',
      fixture.workspace,
      '--json',
    ]);
    expect(drift.ok).toBe(false);
    expect(drift.exitCode).not.toBe(0);
    expect(
      drift.diagnostics.some(
        ({ message, path }) =>
          path?.includes('building-trails/SKILL.md') === true ||
          message.includes('building-trails/SKILL.md')
      )
    ).toBe(true);

    await writeFile(output, original);
    requireCliSuccess(
      await runCli(fixture, [
        'check',
        '--only',
        'outputs',
        '--root',
        fixture.workspace,
        '--json',
      ])
    );
  });
});
