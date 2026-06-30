/* oxlint-disable max-lines-per-function, max-statements -- release-note parsing keeps source extraction explicit. */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_REPO = 'outfitter-dev/trails';

interface PackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly version?: string;
}

interface ReleaseNotesWorkspace {
  readonly isPrivate: boolean;
  readonly name: string;
  readonly path: string;
  readonly version: string;
}

export interface ReleaseNotesChange {
  readonly commit?: string | undefined;
  readonly packages: readonly string[];
  readonly summary: string;
  readonly url?: string | undefined;
}

export interface ReleaseNotesPackageVersion {
  readonly name: string;
  readonly version: string;
}

export interface ReleaseNotesInput {
  readonly changes: readonly ReleaseNotesChange[];
  readonly distTag: string;
  readonly mode: 'github-release' | 'release-pr';
  readonly packageVersions: readonly ReleaseNotesPackageVersion[];
  readonly repo?: string | undefined;
  readonly version: string;
}

interface ChangelogEntryInput {
  readonly changelog: string;
  readonly packageName: string;
  readonly version: string;
}

export interface ReleaseNotesParsedChange {
  readonly commit?: string | undefined;
  readonly packageName: string;
  readonly summary: string;
  readonly url?: string | undefined;
}

export interface ReleaseNotesCollectOptions {
  readonly distTag?: string | undefined;
  readonly mode: ReleaseNotesInput['mode'];
  readonly repo?: string | undefined;
  readonly repoRoot: string;
  readonly version?: string | undefined;
}

interface CurrentParsedChange {
  readonly commit?: string | undefined;
  readonly packageName: string;
  readonly summaryLines: string[];
  readonly url?: string | undefined;
}

const readJson = async <T>(path: string): Promise<T> =>
  (await Bun.file(path).json()) as T;

const discoverWorkspaceDirs = async (
  repoRoot: string,
  patterns: readonly string[]
): Promise<string[]> => {
  const dirs: string[] = [];

  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = join(repoRoot, pattern.slice(0, -2));
      const entries = await readdir(parent, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const dir = join(parent, entry.name);
        if (await Bun.file(join(dir, 'package.json')).exists()) {
          dirs.push(dir);
        }
      }
      continue;
    }

    const dir = join(repoRoot, pattern);
    if (await Bun.file(join(dir, 'package.json')).exists()) {
      dirs.push(dir);
    }
  }

  return dirs;
};

const discoverReleaseNotesWorkspaces = async (
  repoRoot: string,
  { includePrivate }: { readonly includePrivate: boolean }
): Promise<ReleaseNotesWorkspace[]> => {
  const root = await readJson<{ workspaces?: string[] }>(
    join(repoRoot, 'package.json')
  );
  const dirs = await discoverWorkspaceDirs(repoRoot, root.workspaces ?? []);
  const workspaces: ReleaseNotesWorkspace[] = [];

  for (const dir of dirs) {
    const pkg = await readJson<PackageJson>(join(dir, 'package.json'));
    if (
      typeof pkg.name !== 'string' ||
      !pkg.name.startsWith('@ontrails/') ||
      typeof pkg.version !== 'string' ||
      (pkg.private === true && !includePrivate)
    ) {
      continue;
    }
    workspaces.push({
      isPrivate: pkg.private === true,
      name: pkg.name,
      path: dir.slice(repoRoot.length + 1),
      version: pkg.version,
    });
  }

  return workspaces.toSorted((a, b) => a.name.localeCompare(b.name));
};

const readTrailsVersion = async (repoRoot: string): Promise<string> => {
  const pkg = await readJson<PackageJson>(
    join(repoRoot, 'apps', 'trails', 'package.json')
  );
  if (!pkg.version) {
    throw new Error('Missing version in apps/trails/package.json');
  }
  return pkg.version;
};

const distTagForVersion = (version: string): string =>
  version.includes('-')
    ? (version.split('-')[1]?.split('.')[0] ?? 'beta')
    : 'latest';

export const extractChangelogEntry = (
  changelog: string,
  version: string
): string | undefined => {
  const lines = changelog.split('\n');
  const heading = `## ${version}`;
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return undefined;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+\S/u.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }

  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
};

const normalizeSummary = (lines: readonly string[]): string =>
  lines.join(' ').replaceAll(/\s+/gu, ' ').trim();

const parseChangeStart = (
  line: string
): Omit<ReleaseNotesParsedChange, 'packageName'> | undefined => {
  if (
    !line.startsWith('- ') ||
    line.startsWith('- Updated dependencies') ||
    line.startsWith('- @ontrails/')
  ) {
    return undefined;
  }

  const linked = line.match(/^- \[`?([0-9a-f]{7,40})`?\]\(([^)]+)\):\s*(.*)$/u);
  if (linked) {
    return {
      commit: linked[1],
      summary: linked[3] ?? '',
      url: linked[2],
    };
  }

  const raw = line.match(/^- ([0-9a-f]{7,40}):\s*(.*)$/u);
  if (raw) {
    return {
      commit: raw[1],
      summary: raw[2] ?? '',
    };
  }

  return { summary: line.slice(2) };
};

const parseChangelogEntryChanges = ({
  changelog,
  packageName,
  version,
}: ChangelogEntryInput): ReleaseNotesParsedChange[] => {
  const entry = extractChangelogEntry(changelog, version);
  if (!entry) {
    return [];
  }

  const changes: ReleaseNotesParsedChange[] = [];
  let current: CurrentParsedChange | undefined;

  const flush = () => {
    if (!current) {
      return;
    }
    const summary = normalizeSummary(current.summaryLines);
    if (summary) {
      changes.push({
        ...(current.commit === undefined ? {} : { commit: current.commit }),
        packageName: current.packageName,
        summary,
        ...(current.url === undefined ? {} : { url: current.url }),
      });
    }
  };

  for (const line of entry.split('\n')) {
    const start = parseChangeStart(line);
    if (start) {
      flush();
      current = {
        ...(start.commit === undefined ? {} : { commit: start.commit }),
        packageName,
        summaryLines: [start.summary],
        ...(start.url === undefined ? {} : { url: start.url }),
      };
      continue;
    }

    if (current && line.startsWith('  ') && line.trim()) {
      current.summaryLines.push(line.trim());
      continue;
    }

    if (line.startsWith('- ')) {
      flush();
      current = undefined;
    }
  }

  flush();
  return changes;
};

export const dedupeReleaseChanges = (
  changes: readonly ReleaseNotesParsedChange[]
): ReleaseNotesChange[] => {
  const byKey = new Map<string, ReleaseNotesChange>();

  for (const change of changes) {
    const key = `${change.commit ?? ''}\n${change.summary}`;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        packages: [
          ...new Set([...existing.packages, change.packageName]),
        ].toSorted(),
      });
      continue;
    }

    byKey.set(key, {
      ...(change.commit === undefined ? {} : { commit: change.commit }),
      packages: [change.packageName],
      summary: change.summary,
      ...(change.url === undefined ? {} : { url: change.url }),
    });
  }

  return [...byKey.values()];
};

const renderCommitLink = (change: ReleaseNotesChange, repo: string): string => {
  if (!change.commit) {
    return '';
  }
  const short = change.commit.slice(0, 7);
  const url =
    change.url ?? `https://github.com/${repo}/commit/${change.commit}`;
  return `[\`${short}\`](${url}): `;
};

const renderPackages = (packages: readonly string[]): string =>
  packages.map((name) => `\`${name}\``).join(', ');

export const renderReleaseNotes = ({
  changes,
  distTag,
  mode,
  packageVersions,
  repo = DEFAULT_REPO,
  version,
}: ReleaseNotesInput): string => {
  const intro =
    mode === 'release-pr'
      ? `${packageVersions.length} \`@ontrails/*\` packages will be bumped to \`${version}\`.`
      : `Published the publishable \`@ontrails/*\` package set at \`${version}\` on the \`${distTag}\` dist-tag.`;
  const highlights = changes.slice(0, 5);
  const lines = [`# Release ${version}`, '', intro, '', '## Highlights', ''];

  if (highlights.length === 0) {
    lines.push('- No user-facing changes were detected in package changelogs.');
  } else {
    lines.push(...highlights.map((change) => `- ${change.summary}`));
  }

  lines.push('', '## Changes', '');
  if (changes.length === 0) {
    lines.push('- No user-facing changes were detected in package changelogs.');
  } else {
    lines.push(
      ...changes.map(
        (change) =>
          `- ${renderCommitLink(change, repo)}${change.summary} Packages: ${renderPackages(change.packages)}`
      )
    );
  }

  lines.push(
    '',
    '<details>',
    '<summary>Package Versions</summary>',
    '',
    ...packageVersions.map((pkg) => `- \`${pkg.name}@${pkg.version}\``),
    '',
    '</details>',
    ''
  );

  return lines.join('\n');
};

export const collectReleaseNotesInput = async ({
  distTag,
  mode,
  repo,
  repoRoot,
  version,
}: ReleaseNotesCollectOptions): Promise<ReleaseNotesInput> => {
  const resolvedVersion = version ?? (await readTrailsVersion(repoRoot));
  const resolvedDistTag = distTag ?? distTagForVersion(resolvedVersion);
  const workspaces = await discoverReleaseNotesWorkspaces(repoRoot, {
    includePrivate: mode === 'release-pr',
  });
  const packageVersions = workspaces.map((workspace) => ({
    name: workspace.name,
    version: workspace.version,
  }));
  const parsedChangesByPackage = await Promise.all(
    workspaces.map(async (workspace: ReleaseNotesWorkspace) =>
      parseChangelogEntryChanges({
        changelog: await Bun.file(
          join(repoRoot, workspace.path, 'CHANGELOG.md')
        ).text(),
        packageName: workspace.name,
        version: resolvedVersion,
      })
    )
  );
  const parsedChanges = parsedChangesByPackage.flat();

  return {
    changes: dedupeReleaseChanges(parsedChanges),
    distTag: resolvedDistTag,
    mode,
    packageVersions,
    ...(repo === undefined ? {} : { repo }),
    version: resolvedVersion,
  };
};
