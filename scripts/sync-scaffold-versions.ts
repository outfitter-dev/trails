#!/usr/bin/env bun
/**
 * Generates or validates `apps/trails/src/scaffold-versions.generated.ts`
 * from the root `package.json` catalog and devDependencies.
 *
 * Usage:
 *   bun scripts/sync-scaffold-versions.ts            # write generated file
 *   bun scripts/sync-scaffold-versions.ts --check    # exit non-zero on drift
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const rootPackageJsonPath = resolve(repoRoot, 'package.json');
const generatedFilePath = resolve(
  repoRoot,
  'apps/trails/src/scaffold-versions.generated.ts'
);

interface RootPackageJson {
  readonly catalog?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const requireValue = (
  value: string | undefined,
  label: string,
  source: string
): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `sync-scaffold-versions: missing "${label}" under ${source} in ${rootPackageJsonPath}`
    );
  }
  return value;
};

const loadScaffoldVersions = async (): Promise<
  Record<string, string> & Readonly<Record<string, string>>
> => {
  const rootPkg = (await Bun.file(
    rootPackageJsonPath
  ).json()) as RootPackageJson;
  const catalog = rootPkg.catalog ?? {};
  const devDeps = rootPkg.devDependencies ?? {};

  return {
    bunTypes: requireValue(
      devDeps['@types/bun'],
      '@types/bun',
      'devDependencies'
    ),
    commander: requireValue(catalog['commander'], 'commander', 'catalog'),
    lefthook: requireValue(devDeps['lefthook'], 'lefthook', 'devDependencies'),
    oxfmt: requireValue(devDeps['oxfmt'], 'oxfmt', 'devDependencies'),
    oxlint: requireValue(devDeps['oxlint'], 'oxlint', 'devDependencies'),
    typescript: requireValue(
      devDeps['typescript'],
      'typescript',
      'devDependencies'
    ),
    ultracite: requireValue(
      devDeps['ultracite'],
      'ultracite',
      'devDependencies'
    ),
    zod: requireValue(catalog['zod'], 'zod', 'catalog'),
  };
};

const renderGeneratedFile = (
  versions: Record<string, string> & Readonly<Record<string, string>>
): string => {
  const keys = Object.keys(versions).toSorted();
  const lines = keys.map((key: string) => `  ${key}: '${versions[key]}',`);
  return [
    '// GENERATED FILE — do not edit by hand. Run `bun scripts/sync-scaffold-versions.ts` to regenerate.',
    '',
    'export const scaffoldDependencyVersions = {',
    ...lines,
    '} as const;',
    '',
  ].join('\n');
};

const check = async (expected: string): Promise<void> => {
  const existing = await Bun.file(generatedFilePath).text();
  if (existing === expected) {
    return;
  }
  console.error(
    `sync-scaffold-versions: ${generatedFilePath} is out of date.\n` +
      'Run `bun scripts/sync-scaffold-versions.ts` to regenerate.'
  );
  process.exit(1);
};

const run = async (): Promise<void> => {
  const versions = await loadScaffoldVersions();
  const expected = renderGeneratedFile(versions);
  if (process.argv.includes('--check')) {
    await check(expected);
    return;
  }
  await Bun.write(generatedFilePath, expected);
  console.log(`Wrote ${generatedFilePath}`);
};

await run();
