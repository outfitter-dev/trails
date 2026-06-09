/**
 * Scaffold dependency version derivation for the `create.versions` trail.
 *
 * Generates or validates `apps/trails/src/scaffold-versions.generated.ts`
 * from the root `package.json` catalog and devDependencies, and validates
 * that generated `@ontrails/*` package pins track the `@ontrails/trails`
 * version exactly.
 */

import { resolve } from 'node:path';

import {
  ontrailsPackageRange as appOntrailsPackageRange,
  trailsPackageVersion as appTrailsPackageVersion,
} from './versions.js';

interface RootPackageJson {
  readonly catalog?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

export interface OntrailsPackagePinState {
  readonly ontrailsPackageRange?: string;
  readonly trailsPackageVersion?: string;
}

export interface SyncScaffoldVersionsResult {
  readonly generatedPath: string;
  readonly mode: 'check' | 'write';
  readonly written: boolean;
}

export const diagnoseOntrailsPackagePin = ({
  ontrailsPackageRange,
  trailsPackageVersion,
}: OntrailsPackagePinState): string | undefined => {
  if (
    typeof ontrailsPackageRange !== 'string' ||
    typeof trailsPackageVersion !== 'string'
  ) {
    return (
      'create.versions: apps/trails/src/versions.ts must export ' +
      '`ontrailsPackageRange` and `trailsPackageVersion`.'
    );
  }
  if (ontrailsPackageRange !== trailsPackageVersion) {
    return (
      'create.versions: scaffolded @ontrails/* packages must be exact ' +
      `pins for @ontrails/trails (${trailsPackageVersion}); got ` +
      `${ontrailsPackageRange}.`
    );
  }
  return undefined;
};

const requireValue = (
  value: string | undefined,
  label: string,
  source: string,
  rootPackageJsonPath: string
): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `create.versions: missing "${label}" under ${source} in ${rootPackageJsonPath}`
    );
  }
  return value;
};

const loadScaffoldVersions = async (
  rootPackageJsonPath: string
): Promise<Record<string, string> & Readonly<Record<string, string>>> => {
  const rootPkg = (await Bun.file(
    rootPackageJsonPath
  ).json()) as RootPackageJson;
  const catalog = rootPkg.catalog ?? {};
  const devDeps = rootPkg.devDependencies ?? {};

  return {
    bunTypes: requireValue(
      devDeps['@types/bun'],
      '@types/bun',
      'devDependencies',
      rootPackageJsonPath
    ),
    commander: requireValue(
      catalog['commander'],
      'commander',
      'catalog',
      rootPackageJsonPath
    ),
    lefthook: requireValue(
      devDeps['lefthook'],
      'lefthook',
      'devDependencies',
      rootPackageJsonPath
    ),
    oxfmt: requireValue(
      devDeps['oxfmt'],
      'oxfmt',
      'devDependencies',
      rootPackageJsonPath
    ),
    oxlint: requireValue(
      devDeps['oxlint'],
      'oxlint',
      'devDependencies',
      rootPackageJsonPath
    ),
    typescript: requireValue(
      devDeps['typescript'],
      'typescript',
      'devDependencies',
      rootPackageJsonPath
    ),
    ultracite: requireValue(
      devDeps['ultracite'],
      'ultracite',
      'devDependencies',
      rootPackageJsonPath
    ),
    zod: requireValue(catalog['zod'], 'zod', 'catalog', rootPackageJsonPath),
  };
};

const renderGeneratedFile = (
  versions: Record<string, string> & Readonly<Record<string, string>>
): string => {
  const keys = Object.keys(versions).toSorted();
  const lines = keys.map((key: string) => `  ${key}: '${versions[key]}',`);
  return [
    '// GENERATED FILE — do not edit by hand. Run `bun run scaffold-versions:sync` to regenerate.',
    '',
    'export const scaffoldDependencyVersions = {',
    ...lines,
    '} as const;',
    '',
  ].join('\n');
};

export const syncScaffoldVersions = async (options: {
  check: boolean;
  rootDir: string;
}): Promise<SyncScaffoldVersionsResult> => {
  const rootPackageJsonPath = resolve(options.rootDir, 'package.json');
  const generatedPath = resolve(
    options.rootDir,
    'apps/trails/src/scaffold-versions.generated.ts'
  );
  const versions = await loadScaffoldVersions(rootPackageJsonPath);
  const expected = renderGeneratedFile(versions);

  if (options.check) {
    const generatedFile = Bun.file(generatedPath);
    const existing = (await generatedFile.exists())
      ? await generatedFile.text()
      : undefined;
    if (existing !== expected) {
      throw new Error(
        `create.versions: ${generatedPath} is out of date.\n` +
          'Run `bun run scaffold-versions:sync` to regenerate.'
      );
    }
  } else {
    await Bun.write(generatedPath, expected);
  }

  // Normally quiet because versions.ts derives both exports from one source;
  // this trips only if future/manual drift breaks that invariant.
  const diagnostic = diagnoseOntrailsPackagePin({
    ontrailsPackageRange: appOntrailsPackageRange,
    trailsPackageVersion: appTrailsPackageVersion,
  });
  if (diagnostic !== undefined) {
    throw new Error(diagnostic);
  }

  return {
    generatedPath,
    mode: options.check ? 'check' : 'write',
    written: !options.check,
  };
};
