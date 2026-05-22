import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { checkInstalledTrailsSkills } from '../check-installed-trails-skill.js';
import type { InstalledSkillCandidate } from '../check-installed-trails-skill.js';

const renderSkill = (
  version = '1.0.0-beta.18',
  body = '# Trails\n\nCurrent skill guidance.\n'
): string => `---
name: trails
description: Build with Trails.
metadata:
  trails:
    version: ${version}
---

${body}`;

const writeSkillRoot = async (
  rootDir: string,
  options: { body?: string; version?: string } = {}
): Promise<void> => {
  await mkdir(join(rootDir, 'references'), { recursive: true });
  await mkdir(join(rootDir, 'templates'), { recursive: true });
  await writeFile(
    join(rootDir, 'SKILL.md'),
    renderSkill(options.version, options.body)
  );
  await writeFile(
    join(rootDir, 'references/architecture.md'),
    'TopoGraph, lock manifest, and current package guidance.\n'
  );
  await writeFile(
    join(rootDir, 'templates/trail.md'),
    'Use Result.ok() and expectedMatch examples.\n'
  );
};

const withFixture = async <T>(
  fn: (rootDir: string) => Promise<T>
): Promise<T> => {
  const rootDir = await mkdtemp(join(tmpdir(), 'trails-installed-skill-'));
  try {
    return await fn(rootDir);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
};

const checkOne = async (
  sourceDir: string,
  candidate: InstalledSkillCandidate
) =>
  checkInstalledTrailsSkills({
    candidates: [candidate],
    sourceDir,
  });

describe('check-installed-trails-skill', () => {
  test('accepts a matching copied skill root', async () => {
    await withFixture(async (rootDir) => {
      const installedDir = join(rootDir, 'installed/trails');
      const sourceDir = join(rootDir, 'repo/plugin/skills/trails');
      await writeSkillRoot(sourceDir);
      await cp(sourceDir, installedDir, { recursive: true });

      const report = await checkOne(sourceDir, {
        label: 'copy',
        path: installedDir,
      });

      expect(report.hasErrors).toBeFalse();
      expect(report.reports[0]?.kind).toBe('copy');
      expect(report.reports[0]?.findings[0]?.code).toBe('current');
    });
  });

  test('reports a matching symlinked skill root', async () => {
    await withFixture(async (rootDir) => {
      const installedDir = join(rootDir, 'installed/trails');
      const sourceDir = join(rootDir, 'repo/plugin/skills/trails');
      await writeSkillRoot(sourceDir);
      await mkdir(join(rootDir, 'installed'), { recursive: true });
      await symlink(sourceDir, installedDir);

      const report = await checkOne(sourceDir, {
        label: 'claude-home',
        path: installedDir,
      });

      expect(report.hasErrors).toBeFalse();
      expect(report.reports[0]?.kind).toBe('symlink');
      expect(report.reports[0]?.symlinkTarget).toBe(sourceDir);
    });
  });

  test('treats a missing optional skill root as informational', async () => {
    await withFixture(async (rootDir) => {
      const sourceDir = join(rootDir, 'repo/plugin/skills/trails');
      await writeSkillRoot(sourceDir);

      const report = await checkOne(sourceDir, {
        label: 'codex-home',
        optional: true,
        path: join(rootDir, 'missing/trails'),
      });

      expect(report.hasErrors).toBeFalse();
      expect(report.reports[0]?.exists).toBeFalse();
      expect(report.reports[0]?.findings[0]?.code).toBe('missing');
    });
  });

  test('detects copied skill content drift', async () => {
    await withFixture(async (rootDir) => {
      const installedDir = join(rootDir, 'installed/trails');
      const sourceDir = join(rootDir, 'repo/plugin/skills/trails');
      await writeSkillRoot(sourceDir);
      await writeSkillRoot(installedDir);
      await writeFile(join(installedDir, 'templates/trail.md'), 'Old copy.\n');
      await writeFile(join(installedDir, 'extra.md'), 'Extra file.\n');

      const report = await checkOne(sourceDir, {
        label: 'copy',
        path: installedDir,
      });

      expect(report.hasErrors).toBeTrue();
      expect(report.reports[0]?.drift.changed).toContain('templates/trail.md');
      expect(report.reports[0]?.drift.extra).toContain('extra.md');
      expect(
        report.reports[0]?.findings.map((finding) => finding.code)
      ).toContain('content-drift');
    });
  });

  test('detects version drift and stale vocabulary', async () => {
    await withFixture(async (rootDir) => {
      const installedDir = join(rootDir, 'installed/trails');
      const sourceDir = join(rootDir, 'repo/plugin/skills/trails');
      await writeSkillRoot(sourceDir);
      await writeSkillRoot(installedDir, {
        body: `# Trails\n\n${['Surface', ' maps'].join('')} still mention ${[
          'trans',
          'port',
        ].join('')} ${['connect', 'or'].join('')}.\n`,
        version: '1.0.0-beta.17',
      });

      const report = await checkOne(sourceDir, {
        label: 'copy',
        path: installedDir,
      });

      expect(report.hasErrors).toBeTrue();
      expect(report.reports[0]?.staleVocabularyHits.length).toBeGreaterThan(0);
      expect(
        report.reports[0]?.findings.map((finding) => finding.code)
      ).toEqual(expect.arrayContaining(['stale-vocabulary', 'version-drift']));
    });
  });
});
