import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getPackagesSync } from '@manypkg/get-packages';
import { isPlainObject } from '@ontrails/core';
import { z } from 'zod';

const FRONTMATTER = /\s*---([^]*?)\n\s*---(\s*(?:\n|$)[^]*)/u;
const legacyChangeset = z.object({
  releases: z.array(z.object({ name: z.string() })),
});

const packageNames = (content: string): readonly string[] => {
  const frontmatter = FRONTMATTER.exec(content)?.[1];
  if (frontmatter === undefined) {
    throw new Error('Missing changeset YAML frontmatter.');
  }
  const parsed: unknown = Bun.YAML.parse(frontmatter);
  if (parsed === null || parsed === undefined) {
    return [];
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      'Changeset frontmatter must map package names to release types.'
    );
  }
  return Object.keys(parsed).toSorted();
};

/**
 * Validate package ownership before Changesets calculates a release.
 *
 * Mirrors @changesets/read 0.6.7 getChangesets and getOldChangesets
 * (dist/changesets-read.esm.js:61,115), including retained v1 directories,
 * and @changesets/assemble-release-plan 6.0.9 getRelevantChangesets
 * (dist/changesets-assemble-release-plan.esm.js:544): workspace-name validation
 * precedes consumed prerelease filtering. Valid consumed rows remain untouched;
 * removed package names must be cleaned up even in retained prerelease files.
 * Empty inventories use Changesets' pinned package reader for root-only and
 * alternate workspace layouts instead of duplicating workspace-manager rules.
 * Bun parses the YAML boundary here so the public operator does not depend on
 * the repository's development-only Changesets CLI installation.
 */
export const findChangesetPackageErrors = (
  repoRoot: string,
  workspaceNames: ReadonlySet<string>
): readonly string[] => {
  const dir = join(repoRoot, '.changeset');
  if (!existsSync(dir)) {
    return [];
  }
  const knownNames = new Set(workspaceNames);
  const rootManifest = join(repoRoot, 'package.json');
  if (knownNames.size === 0 && existsSync(rootManifest)) {
    try {
      for (const pkg of getPackagesSync(repoRoot).packages) {
        knownNames.add(pkg.packageJson.name);
      }
    } catch (error) {
      return [
        `Cannot validate changeset package inventory in '${repoRoot}': ${error instanceof Error ? error.message : String(error)}`,
      ];
    }
  }
  const files = readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isDirectory()) {
        return [`${entry.name}/changes.json`];
      }
      return !entry.name.startsWith('.') &&
        entry.name.endsWith('.md') &&
        !/^README\.md$/iu.test(entry.name)
        ? [entry.name]
        : [];
    })
    .toSorted();
  return files.flatMap((name) => {
    const path = `.changeset/${name}`;
    try {
      const content = readFileSync(join(dir, name), 'utf8');
      const names = name.endsWith('/changes.json')
        ? legacyChangeset
            .parse(JSON.parse(content))
            .releases.map((release) => release.name)
        : packageNames(content);
      return [...new Set(names)]
        .toSorted()
        .filter((packageName) => !knownNames.has(packageName))
        .map(
          (packageName) =>
            `Changeset '${path}' references unknown workspace package '${packageName}'.`
        );
    } catch (error) {
      return [
        `Cannot validate changeset '${path}': ${error instanceof Error ? error.message : String(error)}`,
      ];
    }
  });
};
