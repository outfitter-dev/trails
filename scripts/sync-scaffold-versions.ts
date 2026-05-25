#!/usr/bin/env bun
/**
 * Generates or validates `apps/trails/src/scaffold-versions.generated.ts`
 * from the root `package.json` catalog and devDependencies, and validates that
 * generated `@ontrails/*` package pins track the `@ontrails/trails` version
 * exactly.
 *
 * Usage:
 *   bun scripts/sync-scaffold-versions.ts            # write generated file
 *   bun scripts/sync-scaffold-versions.ts --check    # exit non-zero on drift
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const rootPackageJsonPath = resolve(repoRoot, 'package.json');
const generatedFilePath = resolve(
  repoRoot,
  'apps/trails/src/scaffold-versions.generated.ts'
);
const scaffoldVersionsModulePath = resolve(
  repoRoot,
  'apps/trails/src/versions.ts'
);

interface RootPackageJson {
  readonly catalog?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

export interface OntrailsPackagePinState {
  readonly ontrailsPackageRange?: string;
  readonly trailsPackageVersion?: string;
}

type ScaffoldVersionsModule = OntrailsPackagePinState;

export const diagnoseOntrailsPackagePin = ({
  ontrailsPackageRange,
  trailsPackageVersion,
}: OntrailsPackagePinState): string | undefined => {
  if (
    typeof ontrailsPackageRange !== 'string' ||
    typeof trailsPackageVersion !== 'string'
  ) {
    return (
      'sync-scaffold-versions: apps/trails/src/versions.ts must export ' +
      '`ontrailsPackageRange` and `trailsPackageVersion`.'
    );
  }
  if (ontrailsPackageRange !== trailsPackageVersion) {
    return (
      'sync-scaffold-versions: scaffolded @ontrails/* packages must be exact ' +
      `pins for @ontrails/trails (${trailsPackageVersion}); got ` +
      `${ontrailsPackageRange}.`
    );
  }
  return undefined;
};

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

const checkOntrailsPackagePin = async (): Promise<void> => {
  const versionsModule = (await import(
    pathToFileURL(scaffoldVersionsModulePath).href
  )) as ScaffoldVersionsModule;
  // Normally quiet because versions.ts derives both exports from one source;
  // this trips only if future/manual drift breaks that invariant.
  const diagnostic = diagnoseOntrailsPackagePin(versionsModule);
  if (diagnostic !== undefined) {
    console.error(diagnostic);
    process.exit(1);
  }
};

const run = async (): Promise<void> => {
  const versions = await loadScaffoldVersions();
  const expected = renderGeneratedFile(versions);
  if (process.argv.includes('--check')) {
    await check(expected);
    await checkOntrailsPackagePin();
    return;
  }
  await Bun.write(generatedFilePath, expected);
  await checkOntrailsPackagePin();
  console.log(`Wrote ${generatedFilePath}`);
};

if (import.meta.main) {
  await run();
}
