import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { collectReleaseNotesInput, renderReleaseNotes } from './notes.js';
import type { ReleaseNotesCollectOptions } from './notes.js';

const RELEASE_BRANCH = 'changeset-release/main';

type CliOptions = Omit<ReleaseNotesCollectOptions, 'mode'>;

const runText = async (cmd: readonly string[]): Promise<string> => {
  const proc = Bun.spawn([...cmd], { stderr: 'pipe', stdout: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${cmd.join(' ')}\n${stderr.trim()}`
    );
  }
  return stdout.trim();
};

const readRepository = async (): Promise<string> =>
  process.env['GITHUB_REPOSITORY'] ??
  (await runText([
    'gh',
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]));

const findReleasePullRequestNumber = async (
  repo: string
): Promise<string | undefined> => {
  const output = await runText([
    'gh',
    'pr',
    'list',
    '--repo',
    repo,
    '--head',
    RELEASE_BRANCH,
    '--base',
    'main',
    '--state',
    'open',
    '--json',
    'number',
    '--jq',
    '.[0].number // empty',
  ]);
  return output || undefined;
};

const parseArgs = (args: readonly string[]): CliOptions => {
  let distTag: string | undefined;
  let repo: string | undefined;
  let repoRoot = resolve(process.cwd());
  let version: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dist-tag') {
      index += 1;
      distTag = args[index];
      continue;
    }
    if (arg === '--repo') {
      index += 1;
      repo = args[index];
      continue;
    }
    if (arg === '--repo-root') {
      index += 1;
      repoRoot = resolve(args[index] ?? repoRoot);
      continue;
    }
    if (arg === '--version') {
      index += 1;
      version = args[index];
      continue;
    }
    throw new Error(`Unknown release-notes option: ${arg}`);
  }

  return {
    ...(distTag === undefined ? {} : { distTag }),
    ...(repo === undefined ? {} : { repo }),
    repoRoot,
    ...(version === undefined ? {} : { version }),
  };
};

const commandGithubRelease = async (args: readonly string[]): Promise<void> => {
  const input = await collectReleaseNotesInput({
    ...parseArgs(args),
    mode: 'github-release',
  });
  process.stdout.write(renderReleaseNotes(input));
};

const commandReleasePr = async (args: readonly string[]): Promise<void> => {
  const input = await collectReleaseNotesInput({
    ...parseArgs(args),
    mode: 'release-pr',
  });
  process.stdout.write(renderReleaseNotes(input));
};

const commandUpdateReleasePr = async (
  args: readonly string[]
): Promise<void> => {
  const options = parseArgs(args);
  const repo = options.repo ?? (await readRepository());
  const number = await findReleasePullRequestNumber(repo);
  if (!number) {
    throw new Error(`No open ${RELEASE_BRANCH} pull request found`);
  }
  const input = await collectReleaseNotesInput({
    ...options,
    mode: 'release-pr',
    repo,
  });
  const dir = await mkdtemp(join(tmpdir(), 'trails-release-notes-'));
  const bodyPath = join(dir, 'body.md');
  await writeFile(bodyPath, renderReleaseNotes(input));
  await runText([
    'gh',
    'pr',
    'edit',
    number,
    '--repo',
    repo,
    '--body-file',
    bodyPath,
  ]);
  console.error(`trails: updated release PR #${number} body`);
};

export const runReleaseNotesCli = async (
  args: readonly string[] = process.argv.slice(2)
): Promise<number> => {
  try {
    const [command, ...rest] = args;
    if (command === 'github-release') {
      await commandGithubRelease(rest);
      return 0;
    }
    if (command === 'release-pr') {
      await commandReleasePr(rest);
      return 0;
    }
    if (command === 'update-release-pr') {
      await commandUpdateReleasePr(rest);
      return 0;
    }
    throw new Error(
      'Usage: bun scripts/release-notes.ts <github-release|release-pr|update-release-pr> [--version <version>] [--dist-tag <tag>] [--repo <owner/name>] [--repo-root <path>]'
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
