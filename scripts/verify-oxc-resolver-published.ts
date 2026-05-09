#!/usr/bin/env bun
/**
 * Verifies the `oxc-resolver` signal Warden can rely on for packed package
 * export-map drift.
 *
 * The check intentionally uses a real Bun-packed `@ontrails/warden` tarball
 * and a temp consumer install of `oxc-resolver`. The target subpath is present
 * in the packed package contents but absent from the package `exports` map.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const resolverVersion = '11.19.1';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wardenRoot = join(repoRoot, 'packages', 'warden');
const keepTemp = process.argv.includes('--keep-temp');

const conditionNames = ['bun', 'node', 'import', 'default'] as const;
const expectedExportError =
  '"./trails/wrap-rule" is not exported under the conditions ["bun", "node", "import", "default"] from package';

interface ResolveResult {
  readonly path?: string;
  readonly error?: string;
  readonly builtin?: unknown;
  readonly moduleType?: string;
  readonly packageJsonPath?: string;
}

// Shape of the JSON emitted by resolver-check.mjs. Only `results` is asserted.
interface ResolverCheckResult {
  readonly options: {
    readonly conditionNames: readonly string[];
    readonly extensions: readonly string[];
    readonly tsconfig: 'auto';
    readonly symlinks: boolean;
    readonly builtinModules: boolean;
    readonly moduleType: boolean;
  };
  readonly results: Record<string, ResolveResult>;
}

const commandText = (cmd: readonly string[]): string => cmd.join(' ');

const run = (
  cmd: readonly string[],
  cwd: string
): { readonly stdout: string; readonly stderr: string } => {
  const result = spawnSync(cmd[0] as string, cmd.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      [
        `Command failed in ${cwd}: ${commandText(cmd)}`,
        result.error ? `spawn error: ${result.error.message}` : undefined,
        `exit: ${result.status ?? 'signal'}`,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined,
      ]
        .filter((line): line is string => typeof line === 'string')
        .join('\n')
    );
  }

  return {
    stderr: result.stderr,
    stdout: result.stdout,
  };
};

const lastOutputLine = (output: string): string => {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.at(-1);
  if (line === undefined) {
    throw new Error('Expected command output, received none');
  }
  return line;
};

const requireResult = (
  check: ResolverCheckResult,
  specifier: string
): ResolveResult => {
  const result = check.results[specifier];
  if (result === undefined) {
    throw new Error(`Resolver check omitted ${specifier}`);
  }
  return result;
};

const assertResolved = (
  check: ResolverCheckResult,
  specifier: string
): ResolveResult => {
  const result = requireResult(check, specifier);
  if (result.error !== undefined || result.path === undefined) {
    throw new Error(
      `${specifier} should resolve through the packed export map, got ${JSON.stringify(result)}`
    );
  }
  return result;
};

const assertExportBlocked = (
  check: ResolverCheckResult,
  specifier: string
): string => {
  const result = requireResult(check, specifier);
  if (result.error === undefined) {
    throw new Error(
      `${specifier} should be blocked by the packed export map, got ${JSON.stringify(result)}`
    );
  }
  if (!result.error.includes(expectedExportError)) {
    throw new Error(
      `${specifier} produced an unexpected resolver error:\n${result.error}`
    );
  }
  return result.error;
};

const writeConsumerFiles = async (consumerRoot: string): Promise<void> => {
  await writeFile(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        dependencies: {
          'oxc-resolver': resolverVersion,
        },
        type: 'module',
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    join(consumerRoot, 'importer.mjs'),
    'import { wrapRule } from "@ontrails/warden/trails/wrap-rule";\n'
  );
  await writeFile(
    join(consumerRoot, 'resolver-check.mjs'),
    `import { ResolverFactory } from "oxc-resolver";

const importerPath = new URL("./importer.mjs", import.meta.url).pathname;
const options = {
  conditionNames: ${JSON.stringify(conditionNames)},
  extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
  tsconfig: "auto",
  symlinks: true,
  builtinModules: true,
  moduleType: true,
};
const resolver = new ResolverFactory(options);
const specifiers = [
  "@ontrails/warden",
  "@ontrails/warden/ast",
  "@ontrails/warden/trails/wrap-rule",
];
const results = Object.fromEntries(
  specifiers.map((specifier) => [
    specifier,
    resolver.resolveFileSync(importerPath, specifier),
  ])
);

console.log(JSON.stringify({ options, results }, null, 2));
`
  );
};

const main = async (): Promise<void> => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'trails-oxc-resolver-'));
  const packRoot = join(tempRoot, 'pack');
  const consumerRoot = join(tempRoot, 'consumer');
  const packedWardenRoot = join(
    consumerRoot,
    'node_modules',
    '@ontrails',
    'warden'
  );

  try {
    await mkdir(packRoot, { recursive: true });
    await mkdir(packedWardenRoot, { recursive: true });
    await writeConsumerFiles(consumerRoot);

    const pack = run(
      [
        'bun',
        'pm',
        'pack',
        '--destination',
        packRoot,
        '--ignore-scripts',
        '--quiet',
      ],
      wardenRoot
    );
    const tarballPath = lastOutputLine(pack.stdout || pack.stderr);

    run(['bun', 'install', '--ignore-scripts'], consumerRoot);
    run(
      [
        'tar',
        '-xzf',
        tarballPath,
        '-C',
        packedWardenRoot,
        '--strip-components=1',
      ],
      repoRoot
    );

    const packedInternalPath = join(
      packedWardenRoot,
      'src',
      'trails',
      'wrap-rule.ts'
    );
    if (!(await Bun.file(packedInternalPath).exists())) {
      throw new Error(
        `Expected the packed-but-unexported internal target to exist: ${packedInternalPath}`
      );
    }

    const resolverRun = run(['bun', 'resolver-check.mjs'], consumerRoot);
    const check = JSON.parse(resolverRun.stdout) as ResolverCheckResult;
    const rootResult = assertResolved(check, '@ontrails/warden');
    const astResult = assertResolved(check, '@ontrails/warden/ast');
    const blockedError = assertExportBlocked(
      check,
      '@ontrails/warden/trails/wrap-rule'
    );

    console.log('Published resolver verification passed');
    console.log(`resolver: oxc-resolver@${resolverVersion}`);
    console.log(`tarball: ${basename(tarballPath)}`);
    console.log(`conditions: ${conditionNames.join(', ')}`);
    console.log(`root export: ${rootResult.path}`);
    console.log(`ast export: ${astResult.path}`);
    console.log(`packed internal target: ${packedInternalPath}`);
    console.log(`non-exported subpath error: ${blockedError}`);
    console.log(`usable error fragment: ${expectedExportError}`);
    if (keepTemp) {
      console.log(`temp root: ${tempRoot}`);
    }
  } finally {
    if (!keepTemp) {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }
};

await main();
