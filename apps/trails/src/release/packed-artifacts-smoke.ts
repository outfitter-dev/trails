/* oxlint-disable eslint-plugin-jest/require-hook, max-statements -- end-to-end package smoke with temp consumer setup */
/**
 * Packs public first-party packages into tarballs, installs them into a
 * scratch consumer with first-party overrides, and runs the Warden/Trails CLI
 * from the packed artifacts.
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const REPO_ROOT = resolve(process.cwd());

interface PackedSmokePackageJson {
  readonly name?: string;
  readonly private?: boolean;
  readonly version?: string;
  readonly workspaces?: readonly string[];
}

interface PackedSmokeWorkspace {
  readonly name: string;
  readonly path: string;
}

export interface PackedArtifactsSmokeResult {
  readonly check: 'packed-artifacts';
  readonly message: string;
  readonly packageCount: number;
  readonly passed: true;
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

const workspaceDirs = async (): Promise<readonly string[]> => {
  const rootPackage = await readJson<PackedSmokePackageJson>(
    join(REPO_ROOT, 'package.json')
  );
  const dirs: string[] = [];
  for (const pattern of rootPackage.workspaces ?? []) {
    if (!pattern.endsWith('/*')) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }
    const base = join(REPO_ROOT, pattern.slice(0, -2));
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const dir = join(base, entry.name);
      if (
        entry.isDirectory() &&
        (await Bun.file(join(dir, 'package.json')).exists())
      ) {
        dirs.push(dir);
      }
    }
  }
  return dirs.toSorted((a, b) => a.localeCompare(b));
};

const publicFirstPartyWorkspaces = async (): Promise<
  readonly PackedSmokeWorkspace[]
> => {
  const workspaces: PackedSmokeWorkspace[] = [];
  for (const path of await workspaceDirs()) {
    const packageJson = await readJson<PackedSmokePackageJson>(
      join(path, 'package.json')
    );
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
  workspace: PackedSmokeWorkspace,
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

export const runPackedArtifactsSmoke =
  async (): Promise<PackedArtifactsSmokeResult> => {
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
      await runCapture(['bun', 'install', '--silent'], consumerRoot);

      await runCapture(
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
      await runCapture([binPath(consumerRoot, 'trails'), '--help'], REPO_ROOT);
      await runCapture(
        [binPath(consumerRoot, 'trails'), 'warden', '--lock', 'skip'],
        REPO_ROOT
      );

      succeeded = true;
      return {
        check: 'packed-artifacts',
        message: `Packed artifact smoke passed for ${workspaces.length} @ontrails/* packages.`,
        packageCount: workspaces.length,
        passed: true,
      };
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

if (import.meta.main) {
  const result = await runPackedArtifactsSmoke();
  console.log(result.message);
}
