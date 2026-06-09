/* oxlint-disable eslint-plugin-jest/require-hook, max-statements, func-style -- release script with module-level flow */
/**
 * Native Bun release binding for public `@ontrails/*` workspace publication.
 *
 * Auto-discovers workspaces from the root `package.json` `workspaces` field,
 * topo-sorts them by `workspace:` dependency edges, enforces manifest-range
 * cleanliness on the packed tarball (no `workspace:` / `catalog:` leakage),
 * and respects the Changesets prerelease tag by default.
 *
 * @see docs/tenets.md for release posture.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(process.cwd());

/** ANSI color helpers, disabled when stdout is not a TTY or `NO_COLOR` is set. */
const useColor = Boolean(process.stdout.isTTY) && !process.env['NO_COLOR'];
const color = (code: string, text: string): string =>
  useColor ? `\u001B[${code}m${text}\u001B[0m` : text;
const blue = (t: string) => color('0;34', t);
const green = (t: string) => color('0;32', t);
const red = (t: string) => color('0;31', t);

const info = (msg: string) => console.log(`${blue('▸')} ${msg}`);
const success = (msg: string) => console.log(`${green('✓')} ${msg}`);
const fail = (msg: string) => console.error(`${red('✗')} ${msg}`);

/** Parsed CLI options. */
export interface NativeBunPublishOptions {
  readonly mode: 'check' | 'publish';
  readonly tag: string | undefined;
  readonly otp: string | undefined;
  readonly only: readonly string[] | undefined;
}

/** Minimal shape of a workspace `package.json` we care about. */
export interface NativeBunPublishPackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

type DependencyField =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

/** A discovered, publishable workspace. */
export interface NativeBunPublishWorkspace {
  readonly name: string;
  readonly version: string;
  readonly path: string;
  readonly isPrivate: boolean;
  readonly workspaceDeps: readonly string[];
}

const DEPENDENCY_FIELDS: readonly DependencyField[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

const USAGE = `Usage: bun scripts/publish.ts [options]

Publish all public @ontrails/* workspaces in dep order using \`bun publish\`.

Options:
  --check                Pre-publish verification only. Runs \`bun pm pack --dry-run\`
                         (required so \`catalog:\` resolves) and asserts the packed
                         manifest has no \`workspace:\` or \`catalog:\` ranges. No publishing.
  --dry-run              Alias for --check.
  --tag <tag>            npm dist-tag. Defaults to .changeset/pre.json tag when in
                         prerelease mode, otherwise "latest".
  --otp <code>           Two-factor code. Also read from BUN_PUBLISH_OTP.
  --only <name[,name]>   Restrict to the named packages (repeatable). Useful for
                         partial reruns after a mid-matrix failure.
  -h, --help             Show this help and exit.

Exit codes: 0 success, 1 publish/check failure, 2 arg-parse error.`;

/** Alphabetical sort helper, hoisted for reuse. */
const sortAlpha = (names: string[]): string[] =>
  names.sort((a, b) => a.localeCompare(b));

/** Parse CLI args with a tiny hand-rolled parser. Exits with code 2 on error. */
const parseArgs = (argv: readonly string[]): NativeBunPublishOptions => {
  let mode: NativeBunPublishOptions['mode'] = 'publish';
  let tag: string | undefined;
  let otp: string | undefined = process.env['BUN_PUBLISH_OTP'] || undefined;
  const only: string[] = [];

  const needsValue = (flag: string, value: string | undefined): string => {
    if (value === undefined || value.startsWith('--')) {
      fail(`${flag} requires a value`);
      console.error(USAGE);
      process.exit(2);
    }
    return value;
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] as string;
    if (arg === '--check' || arg === '--dry-run') {
      mode = 'check';
    } else if (arg === '--tag') {
      i += 1;
      tag = needsValue('--tag', argv[i]);
    } else if (arg === '--otp') {
      i += 1;
      otp = needsValue('--otp', argv[i]);
    } else if (arg === '--only') {
      i += 1;
      const value = needsValue('--only', argv[i]);
      for (const name of value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        only.push(name);
      }
    } else if (arg === '-h' || arg === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
      console.error(USAGE);
      process.exit(2);
    }
    i += 1;
  }

  return {
    mode,
    only: only.length > 0 ? only : undefined,
    otp,
    tag,
  };
};

/** Read and JSON-parse a file. Throws a readable error on failure. */
const readJson = async <T>(path: string): Promise<T> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }
  const text = await file.text();
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
};

/**
 * Resolve the default dist-tag by inspecting `.changeset/pre.json`.
 * Returns the prerelease tag when Changesets is in `pre` mode, else `"latest"`.
 */
const resolveDefaultTag = async (): Promise<string> => {
  const prePath = join(REPO_ROOT, '.changeset', 'pre.json');
  if (!(await Bun.file(prePath).exists())) {
    return 'latest';
  }
  const pre = await readJson<{ mode?: string; tag?: string }>(prePath);
  if (pre.mode !== 'pre') {
    return 'latest';
  }
  if (typeof pre.tag === 'string' && pre.tag.length > 0) {
    return pre.tag;
  }
  throw new Error(
    `${prePath} has mode="pre" but no usable "tag" field. Set --tag explicitly or fix pre.json before publishing.`
  );
};

/**
 * Expand `workspaces` globs from the root `package.json` into absolute
 * directory paths that contain a `package.json`.
 *
 * Handles the simple `dir/*` pattern actually used in this repo plus bare
 * `dir` entries. Directory listing is cheaper and more predictable here than
 * a full glob implementation.
 */
const discoverWorkspaceDirs = async (
  patterns: readonly string[]
): Promise<string[]> => {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = join(REPO_ROOT, pattern.slice(0, -2));
      let names: string[] = [];
      try {
        const entries = await readdir(parent, { withFileTypes: true });
        names = entries
          .filter((e) => e.isDirectory())
          .map((e) => (typeof e.name === 'string' ? e.name : String(e.name)));
      } catch {
        continue;
      }
      for (const name of names) {
        const dir = join(parent, name);
        if (await Bun.file(join(dir, 'package.json')).exists()) {
          dirs.push(dir);
        }
      }
    } else {
      const dir = join(REPO_ROOT, pattern);
      if (await Bun.file(join(dir, 'package.json')).exists()) {
        dirs.push(dir);
      }
    }
  }
  return dirs;
};

/** Collect all `workspace:`-referenced dep names from a package.json. */
const collectWorkspaceDeps = (pkg: NativeBunPublishPackageJson): string[] => {
  const deps = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const map = pkg[field];
    if (!map || typeof map !== 'object') {
      continue;
    }
    for (const [name, range] of Object.entries(map)) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        deps.add(name);
      }
    }
  }
  return [...deps];
};

const expectedPackedWorkspaceRange = (
  sourceRange: string,
  dep: NativeBunPublishWorkspace
): string | undefined => {
  if (!sourceRange.startsWith('workspace:')) {
    return undefined;
  }
  const protocolRange = sourceRange.slice('workspace:'.length);
  if (protocolRange === '^') {
    return `^${dep.version}`;
  }
  if (protocolRange === '~') {
    return `~${dep.version}`;
  }
  if (protocolRange === '*' || protocolRange === '') {
    return dep.version;
  }
  return protocolRange;
};

export const findPackedFirstPartyDependencyMismatches = ({
  packageName,
  packagePath,
  packedPackage,
  sourcePackage,
  workspacesByName,
}: {
  readonly packageName: string;
  readonly packagePath: string;
  readonly packedPackage: NativeBunPublishPackageJson;
  readonly sourcePackage: NativeBunPublishPackageJson;
  readonly workspacesByName: ReadonlyMap<string, NativeBunPublishWorkspace>;
}): string[] => {
  const mismatches: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const sourceDeps = sourcePackage[field];
    if (!sourceDeps || typeof sourceDeps !== 'object') {
      continue;
    }
    const packedDeps = packedPackage[field] ?? {};
    for (const [depName, sourceRange] of Object.entries(sourceDeps)) {
      const dep = workspacesByName.get(depName);
      if (
        !dep ||
        !dep.name.startsWith('@ontrails/') ||
        typeof sourceRange !== 'string'
      ) {
        continue;
      }
      const expected = expectedPackedWorkspaceRange(sourceRange, dep);
      if (!expected) {
        continue;
      }
      const actual = packedDeps[depName] ?? '(missing)';
      if (actual !== expected) {
        const depPath = relative(REPO_ROOT, dep.path);
        mismatches.push(
          `${packageName} packed ${field} ${depName} resolved to ${actual}, expected ${expected} from ${depPath}/package.json`
        );
      }
    }
  }
  if (mismatches.length === 0) {
    return [];
  }
  const relPath = relative(REPO_ROOT, packagePath);
  return [
    `Packed manifest for ${packageName} (${relPath}) contains stale first-party workspace dependency ranges:`,
    ...mismatches.map((mismatch) => `  ${mismatch}`),
  ];
};

/** Discover all workspace packages and enrich with dep edges. */
const discoverWorkspaces = async (): Promise<NativeBunPublishWorkspace[]> => {
  const root = await readJson<{ workspaces?: string[] }>(
    join(REPO_ROOT, 'package.json')
  );
  if (!root.workspaces || root.workspaces.length === 0) {
    throw new Error('Root package.json has no "workspaces" field');
  }
  const dirs = await discoverWorkspaceDirs(root.workspaces);

  const workspaces: NativeBunPublishWorkspace[] = [];
  for (const dir of dirs) {
    const pkg = await readJson<NativeBunPublishPackageJson>(
      join(dir, 'package.json')
    );
    if (!pkg.name) {
      continue;
    }
    workspaces.push({
      isPrivate: pkg.private === true,
      name: pkg.name,
      path: dir,
      version: pkg.version ?? '0.0.0',
      workspaceDeps: collectWorkspaceDeps(pkg),
    });
  }
  return workspaces;
};

/**
 * Topologically sort workspaces so dependencies come before dependents.
 * Ties broken alphabetically by name for deterministic output. Throws on cycles.
 */
const topoSort = (
  workspaces: readonly NativeBunPublishWorkspace[]
): NativeBunPublishWorkspace[] => {
  const byName = new Map(workspaces.map((w) => [w.name, w] as const));
  const indegree = new Map<string, number>();
  const reverseEdges = new Map<string, Set<string>>();

  for (const w of workspaces) {
    indegree.set(w.name, 0);
    reverseEdges.set(w.name, new Set());
  }
  for (const w of workspaces) {
    for (const dep of w.workspaceDeps) {
      if (!byName.has(dep)) {
        continue;
      }
      indegree.set(w.name, (indegree.get(w.name) ?? 0) + 1);
      reverseEdges.get(dep)?.add(w.name);
    }
  }

  const ready: string[] = sortAlpha(
    [...indegree.entries()].filter(([, n]) => n === 0).map(([name]) => name)
  );

  const out: NativeBunPublishWorkspace[] = [];
  while (ready.length > 0) {
    const name = ready.shift() as string;
    const ws = byName.get(name);
    if (ws) {
      out.push(ws);
    }
    const dependents = sortAlpha([...(reverseEdges.get(name) ?? [])]);
    for (const dep of dependents) {
      const next = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, next);
      if (next === 0) {
        const idx = ready.findIndex((n) => n.localeCompare(dep) > 0);
        if (idx === -1) {
          ready.push(dep);
        } else {
          ready.splice(idx, 0, dep);
        }
      }
    }
  }

  if (out.length !== workspaces.length) {
    const remaining = workspaces
      .filter((w) => !out.includes(w))
      .map((w) => w.name);
    throw new Error(
      `Dependency cycle detected among: ${remaining.toSorted().join(', ')}`
    );
  }
  return out;
};

/** Spawn a child process inheriting stdio. Returns its exit code. */
const spawnInherit = async (
  cmd: readonly string[],
  cwd: string
): Promise<number> => {
  const proc = Bun.spawn(cmd as string[], {
    cwd,
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });
  return await proc.exited;
};

/** Spawn a child process and capture stdout (stderr inherited). */
const spawnCapture = async (
  cmd: readonly string[],
  cwd: string
): Promise<{ exitCode: number; stdout: string }> => {
  const proc = Bun.spawn(cmd as string[], {
    cwd,
    stderr: 'inherit',
    stdin: 'ignore',
    stdout: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
};

/**
 * Pack a package to a temp dir and assert the resulting tarball's
 * `package/package.json` contains no `workspace:` or `catalog:` ranges.
 *
 * @throws When packing fails or forbidden ranges are found.
 */
const assertManifestClean = async (
  ws: NativeBunPublishWorkspace,
  workspacesByName: ReadonlyMap<string, NativeBunPublishWorkspace>
): Promise<void> => {
  const tmp = await mkdtemp(join(tmpdir(), 'trails-publish-'));
  try {
    // Use `bun pm pack` so the packed manifest reflects what `bun publish`
    // will upload: workspace: and catalog: ranges are resolved the same way.
    // npm pack does not resolve `catalog:` and would produce false positives.
    const pack = await spawnCapture(
      ['bun', 'pm', 'pack', '--destination', tmp],
      ws.path
    );
    if (pack.exitCode !== 0) {
      throw new Error(
        `bun pm pack failed for ${ws.name} (exit ${pack.exitCode})`
      );
    }
    const tarEntries = await readdir(tmp);
    const tarName = tarEntries.find((n) =>
      typeof n === 'string' ? n.endsWith('.tgz') : String(n).endsWith('.tgz')
    );
    if (!tarName) {
      throw new Error(`bun pm pack produced no tarball for ${ws.name}`);
    }
    const tarPath = join(tmp, String(tarName));

    const extract = Bun.spawn(
      ['tar', '-xOf', tarPath, 'package/package.json'],
      { stderr: 'pipe', stdin: 'ignore', stdout: 'pipe' }
    );
    const [manifestText, tarStderr, extractExit] = await Promise.all([
      new Response(extract.stdout).text(),
      new Response(extract.stderr).text(),
      extract.exited,
    ]);
    if (extractExit !== 0) {
      const detail = tarStderr.trim() || '(no stderr output)';
      throw new Error(
        `tar extraction failed for ${ws.name} (exit ${extractExit}): ${detail}`
      );
    }

    let packedPackage: NativeBunPublishPackageJson;
    try {
      packedPackage = JSON.parse(manifestText) as NativeBunPublishPackageJson;
    } catch (error) {
      throw new Error(
        `Invalid packed package.json for ${ws.name}: ${(error as Error).message}`,
        { cause: error }
      );
    }

    const offenders: string[] = [];
    for (const [lineNo, line] of manifestText.split('\n').entries()) {
      if (line.includes('"workspace:') || line.includes('"catalog:')) {
        offenders.push(`  line ${lineNo + 1}: ${line.trim()}`);
      }
    }
    if (offenders.length > 0) {
      const relPath = relative(REPO_ROOT, ws.path);
      const hint =
        '  Hint: `bun publish` rewrites these at pack time. Verify the package was packed via bun, not npm.';
      throw new Error(
        `Packed manifest for ${ws.name} (${relPath}) contains forbidden ranges:\n${offenders.join('\n')}\n${hint}`
      );
    }
    const sourcePackage = await readJson<NativeBunPublishPackageJson>(
      join(ws.path, 'package.json')
    );
    const mismatches = findPackedFirstPartyDependencyMismatches({
      packageName: ws.name,
      packagePath: ws.path,
      packedPackage,
      sourcePackage,
      workspacesByName,
    });
    if (mismatches.length > 0) {
      throw new Error(mismatches.join('\n'));
    }
  } finally {
    await rm(tmp, { force: true, recursive: true });
  }
};

/** Run `--check` flow: pack dry-run plus manifest-range assertion per package. */
const runCheck = async (
  workspaces: readonly NativeBunPublishWorkspace[],
  allWorkspaces: readonly NativeBunPublishWorkspace[]
): Promise<number> => {
  const workspacesByName = new Map(allWorkspaces.map((ws) => [ws.name, ws]));
  for (const ws of workspaces) {
    if (ws.isPrivate) {
      info(`Skipping ${ws.name} (private)`);
      continue;
    }
    info(`Checking ${ws.name}@${ws.version}...`);
    const dryRun = await spawnInherit(
      ['bun', 'pm', 'pack', '--dry-run'],
      ws.path
    );
    if (dryRun !== 0) {
      fail(`bun pm pack --dry-run failed for ${ws.name}`);
      return 1;
    }
    try {
      await assertManifestClean(ws, workspacesByName);
    } catch (error) {
      fail((error as Error).message);
      return 1;
    }
    success(`${ws.name}@${ws.version} pack check passed`);
  }
  console.log('');
  success('All package pack checks passed!');
  return 0;
};

/** Run the actual publish flow sequentially. Aborts on first failure. */
const runPublish = async (
  workspaces: readonly NativeBunPublishWorkspace[],
  tag: string,
  otp: string | undefined
): Promise<number> => {
  for (const ws of workspaces) {
    if (ws.isPrivate) {
      info(`Skipping ${ws.name} (private)`);
      continue;
    }
    info(`Publishing ${ws.name}@${ws.version}... (tag=${tag})`);
    const cmd: string[] = [
      'bun',
      'publish',
      '--access',
      'public',
      '--tag',
      tag,
    ];
    if (otp) {
      cmd.push('--otp', otp);
    }
    const code = await spawnInherit(cmd, ws.path);
    if (code !== 0) {
      fail(
        `Failed to publish ${ws.name} (exit ${code}); aborting remaining publishes`
      );
      return 1;
    }
    success(`${ws.name}@${ws.version} published`);
  }
  console.log('');
  success('All packages published!');
  return 0;
};

/** Apply `--only` filter, erroring if any requested name is unknown. */
const applyOnlyFilter = (
  workspaces: readonly NativeBunPublishWorkspace[],
  only: readonly string[] | undefined
): readonly NativeBunPublishWorkspace[] => {
  if (!only) {
    return workspaces;
  }
  const set = new Set(only);
  const names = new Set(workspaces.map((w) => w.name));
  const unknown = [...set].filter((n) => !names.has(n));
  if (unknown.length > 0) {
    fail(`--only references unknown packages: ${unknown.join(', ')}`);
    process.exit(2);
  }
  return workspaces.filter((w) => set.has(w.name));
};

export const runNativeBunPublishCli = async (
  args: readonly string[] = process.argv.slice(2)
): Promise<number> => {
  try {
    const opts = parseArgs(args);
    const all = await discoverWorkspaces();
    const sorted = topoSort(all);
    const selected = applyOnlyFilter(sorted, opts.only);

    if (selected.length === 0) {
      fail('No workspaces selected');
      return 1;
    }

    if (opts.mode === 'check') {
      return await runCheck(selected, all);
    }

    const tag = opts.tag ?? (await resolveDefaultTag());
    if (!tag) {
      fail('Could not resolve a dist-tag. Pass --tag <tag> explicitly.');
      return 1;
    }
    return await runPublish(selected, tag, opts.otp);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fail(msg);
    if (process.env['DEBUG'] === '1' && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    return 1;
  }
};

if (import.meta.main) {
  process.exit(await runNativeBunPublishCli(process.argv.slice(2)));
}
