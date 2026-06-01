#!/usr/bin/env bun
/* oxlint-disable eslint-plugin-jest/require-hook, max-statements -- end-to-end package smoke with temp consumer setup */
/**
 * Packs public first-party packages into tarballs, installs them into a
 * scratch consumer with first-party overrides, and runs the Warden/Trails CLI
 * from the packed artifacts.
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');

interface PackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly version?: string;
  readonly workspaces?: readonly string[];
}

interface Workspace {
  readonly name: string;
  readonly path: string;
}

const commandText = (cmd: readonly string[]): string => cmd.join(' ');

const readJson = async <T>(path: string): Promise<T> =>
  (await Bun.file(path).json()) as T;

const lastOutputLine = (output: string): string => {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .findLast((item) => item.length > 0);
  if (line === undefined) {
    throw new Error('Expected command output, received none');
  }
  return line;
};

const runCapture = async (
  cmd: readonly string[],
  cwd: string
): Promise<string> => {
  const proc = Bun.spawn(cmd as string[], {
    cwd,
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed in ${cwd}: ${commandText(cmd)}`,
        `exit: ${exitCode}`,
        stdout.trim() ? `stdout:\n${stdout}` : undefined,
        stderr.trim() ? `stderr:\n${stderr}` : undefined,
      ]
        .filter((line): line is string => typeof line === 'string')
        .join('\n')
    );
  }
  return stdout || stderr;
};

const runInherit = async (
  cmd: readonly string[],
  cwd: string,
  stdout: 'inherit' | 'pipe' = 'inherit'
): Promise<void> => {
  const proc = Bun.spawn(cmd as string[], {
    cwd,
    stderr: 'inherit',
    stdin: 'ignore',
    stdout,
  });
  if (stdout === 'pipe') {
    await new Response(proc.stdout).text();
  }
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Command failed in ${cwd}: ${commandText(cmd)} (exit ${exitCode})`
    );
  }
};

const workspaceDirs = async (): Promise<readonly string[]> => {
  const rootPackage = await readJson<PackageJson>(
    join(REPO_ROOT, 'package.json')
  );
  const dirs: string[] = [];
  for (const pattern of rootPackage.workspaces ?? []) {
    if (!pattern.endsWith('/*')) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }
    const base = join(REPO_ROOT, pattern.slice(0, -2));
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push(join(base, entry.name));
      }
    }
  }
  return dirs.toSorted((a, b) => a.localeCompare(b));
};

const publicFirstPartyWorkspaces = async (): Promise<readonly Workspace[]> => {
  const workspaces: Workspace[] = [];
  for (const path of await workspaceDirs()) {
    const packageJson = await readJson<PackageJson>(join(path, 'package.json'));
    if (
      packageJson.private !== true &&
      packageJson.name?.startsWith('@ontrails/') &&
      packageJson.version !== undefined
    ) {
      workspaces.push({
        name: packageJson.name,
        path,
      });
    }
  }
  return workspaces.toSorted((a, b) => a.name.localeCompare(b.name));
};

const packWorkspace = async (
  workspace: Workspace,
  packRoot: string
): Promise<string> => {
  const output = await runCapture(
    ['bun', 'pm', 'pack', '--destination', packRoot, '--quiet'],
    workspace.path
  );
  const tarball = lastOutputLine(output);
  const destinationPath = isAbsolute(tarball)
    ? tarball
    : join(packRoot, tarball);
  if (await Bun.file(destinationPath).exists()) {
    return destinationPath;
  }
  throw new Error(
    `bun pm pack did not create expected tarball for ${workspace.name}: ${destinationPath} (destination: ${packRoot})`
  );
};

const writeConsumerManifest = async (
  consumerRoot: string,
  tarballsByName: ReadonlyMap<string, string>
): Promise<void> => {
  const tarballDependencies = Object.fromEntries(
    [...tarballsByName.entries()].map(([name, tarball]) => [
      name,
      `file:${tarball}`,
    ])
  );
  await writeFile(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        dependencies: tarballDependencies,
        overrides: tarballDependencies,
        private: true,
        type: 'module',
      },
      null,
      2
    )}\n`
  );
};

const binPath = (consumerRoot: string, name: 'trails' | 'warden'): string =>
  join(consumerRoot, 'node_modules', '.bin', name);

const main = async (): Promise<void> => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'trails-packed-dogfood-'));
  const packRoot = join(tempRoot, 'pack');
  const consumerRoot = join(tempRoot, 'consumer');
  let succeeded = false;

  try {
    await Promise.all([
      mkdir(packRoot, { recursive: true }),
      mkdir(consumerRoot, { recursive: true }),
    ]);

    const workspaces = await publicFirstPartyWorkspaces();
    const tarballsByName = new Map<string, string>();
    for (const workspace of workspaces) {
      tarballsByName.set(
        workspace.name,
        await packWorkspace(workspace, packRoot)
      );
    }

    await writeConsumerManifest(consumerRoot, tarballsByName);
    await runInherit(['bun', 'install', '--silent'], consumerRoot);

    await runInherit(
      [
        binPath(consumerRoot, 'warden'),
        '--root-dir',
        REPO_ROOT,
        '--lock',
        'skip',
        '--format',
        'summary',
      ],
      REPO_ROOT
    );
    await runInherit(
      [binPath(consumerRoot, 'trails'), '--help'],
      REPO_ROOT,
      'pipe'
    );
    await runInherit(
      [binPath(consumerRoot, 'trails'), 'warden', '--lock', 'skip'],
      REPO_ROOT
    );

    console.log(
      `Packed dogfood passed for ${workspaces.length} @ontrails/* packages`
    );
    succeeded = true;
  } finally {
    if (succeeded) {
      await rm(tempRoot, { force: true, recursive: true });
    } else {
      console.error(
        `Packed dogfood temp root kept for inspection: ${tempRoot}`
      );
    }
  }
};

await main();
