import {
  ConflictError,
  InternalError,
  NotFoundError,
  Result,
  ValidationError,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import { readFile, realpath } from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import { z } from 'zod';

import type {
  RegradePackageSourceError,
  RegradePackageSourceExpectation,
} from './package-source.js';

export interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly version?: string;
}

export const exactVersionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const packageNamePattern = /^@ontrails\/[a-z0-9][a-z0-9._-]*$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export const regradePackageSourceExpectationSchema = z.discriminatedUnion(
  'kind',
  [
    z
      .object({
        kind: z.literal('published'),
        name: z.string().regex(packageNamePattern),
        version: z.string().regex(exactVersionPattern),
      })
      .strict(),
    z
      .object({
        kind: z.literal('tarball'),
        name: z.string().regex(packageNamePattern),
        path: z.string().min(1),
        sha256: z.string().regex(sha256Pattern),
      })
      .strict(),
  ]
);

const isNormalizedTarballPath = (value: string): boolean => {
  if (value.length === 0) {
    return false;
  }
  const normalized = posix.normalize(value);
  return normalized === value || `./${normalized}` === value;
};

const errorCause = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const dependencyMapIsValid = (value: unknown): boolean =>
  value === undefined ||
  (isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string'));

export const parsePackageManifest = (
  bytes: string,
  label: string
): TrailsResult<PackageManifest, ValidationError> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch (error) {
    return Result.err(
      new ValidationError(`${label} package manifest is malformed.`, {
        cause: errorCause(error),
      })
    );
  }
  if (
    !isRecord(parsed) ||
    (parsed['name'] !== undefined && typeof parsed['name'] !== 'string') ||
    (parsed['version'] !== undefined &&
      typeof parsed['version'] !== 'string') ||
    !dependencyMapIsValid(parsed['dependencies']) ||
    !dependencyMapIsValid(parsed['devDependencies']) ||
    !dependencyMapIsValid(parsed['optionalDependencies']) ||
    !dependencyMapIsValid(parsed['peerDependencies'])
  ) {
    return Result.err(
      new ValidationError(`${label} package manifest has an invalid shape.`)
    );
  }
  return Result.ok(parsed as PackageManifest);
};

const validateExpectation = (
  expectation: RegradePackageSourceExpectation
): TrailsResult<void, ValidationError> => {
  if (!packageNamePattern.test(expectation.name)) {
    return Result.err(
      new ValidationError(
        'Regrade package-source proof requires one @ontrails package name.',
        { context: { name: expectation.name } }
      )
    );
  }
  if (
    expectation.kind === 'published' &&
    !exactVersionPattern.test(expectation.version)
  ) {
    return Result.err(
      new ValidationError(
        'Published Regrade package-source proof requires an exact version.',
        { context: { version: expectation.version } }
      )
    );
  }
  if (
    expectation.kind === 'tarball' &&
    !sha256Pattern.test(expectation.sha256)
  ) {
    return Result.err(
      new ValidationError(
        'Tarball Regrade package-source proof requires a lowercase SHA-256 digest.',
        { context: { sha256: expectation.sha256 } }
      )
    );
  }
  if (
    expectation.kind === 'tarball' &&
    !isNormalizedTarballPath(expectation.path)
  ) {
    return Result.err(
      new ValidationError(
        'Tarball Regrade package-source proof requires a normalized path.',
        { context: { path: expectation.path } }
      )
    );
  }
  return Result.ok();
};

const directSpecifier = (
  manifest: PackageManifest,
  name: string
): TrailsResult<string | undefined, ConflictError> => {
  const declarations = [
    manifest.dependencies?.[name],
    manifest.optionalDependencies?.[name],
    manifest.peerDependencies?.[name],
    manifest.devDependencies?.[name],
  ].filter((specifier): specifier is string => specifier !== undefined);
  if (new Set(declarations).size > 1) {
    return Result.err(
      new ConflictError(
        `Downstream manifest declares conflicting sources for "${name}".`,
        { context: { declarations, name } }
      )
    );
  }
  return Result.ok(declarations[0]);
};

const normalizedTarballDeclaration = (
  root: string,
  specifier: string
): string | undefined => {
  if (!specifier.startsWith('file:')) {
    return undefined;
  }
  const locator = specifier.slice('file:'.length);
  if (!isNormalizedTarballPath(locator)) {
    return undefined;
  }
  return resolve(root, locator);
};

const findPackageRoot = async (
  entryPath: string | undefined,
  expectedName: string,
  root: string
): Promise<string | undefined> => {
  const resolvedEntryPath =
    entryPath === undefined ? undefined : await realpath(entryPath);
  let searchRoot = root;
  while (true) {
    const candidate = join(searchRoot, 'node_modules', expectedName);
    try {
      const resolvedCandidate = await realpath(candidate);
      const entryRelative =
        resolvedEntryPath === undefined
          ? ''
          : relative(resolvedCandidate, resolvedEntryPath);
      if (
        entryRelative !== '..' &&
        !entryRelative.startsWith(`..${sep}`) &&
        !isAbsolute(entryRelative)
      ) {
        return candidate;
      }
    } catch {
      // Keep walking: dependency installations can be hoisted above the root.
    }
    const parent = dirname(searchRoot);
    if (parent === searchRoot) {
      break;
    }
    searchRoot = parent;
  }
  return undefined;
};

const resolveInstalledPackage = async (
  root: string,
  name: string
): Promise<
  TrailsResult<string, NotFoundError | InternalError | ValidationError>
> => {
  let entryPath: string;
  try {
    entryPath = Bun.resolveSync(name, root);
  } catch (error) {
    try {
      const packageRoot = await findPackageRoot(undefined, name, root);
      if (packageRoot !== undefined) {
        return Result.ok(packageRoot);
      }
    } catch {
      // The normal missing-package error below owns absent direct installs.
    }
    return Result.err(
      new NotFoundError(`Installed package "${name}" was not found.`, {
        cause: errorCause(error),
        context: { name, root },
      })
    );
  }
  try {
    const packageRoot = await findPackageRoot(entryPath, name, root);
    return packageRoot === undefined
      ? Result.err(
          new NotFoundError(
            `Installed package root for "${name}" was not found.`,
            {
              context: { entryPath, name, root },
            }
          )
        )
      : Result.ok(packageRoot);
  } catch (error) {
    return Result.err(
      new InternalError(`Installed package "${name}" could not be inspected.`, {
        cause: errorCause(error),
        context: { name, root },
      })
    );
  }
};

export interface PreparedPackageSource {
  readonly declaredSpecifier: string;
  readonly expectedTarballPath: string | undefined;
  readonly installedRoot: string;
  readonly root: string;
}

export const preparePackageSource = async (params: {
  readonly root: string;
  readonly expected: RegradePackageSourceExpectation;
}): Promise<TrailsResult<PreparedPackageSource, RegradePackageSourceError>> => {
  const expectation = validateExpectation(params.expected);
  if (expectation.isErr()) {
    return expectation;
  }
  const selectedRoot = resolve(params.root);
  let root: string;
  try {
    root = await realpath(selectedRoot);
  } catch (error) {
    return Result.err(
      new NotFoundError('Downstream package root was not found.', {
        cause: errorCause(error),
        context: { root: selectedRoot },
      })
    );
  }
  let rootManifestBytes: string;
  try {
    rootManifestBytes = await readFile(join(root, 'package.json'), 'utf8');
  } catch (error) {
    return Result.err(
      new NotFoundError('Downstream package manifest was not found.', {
        cause: errorCause(error),
        context: { root },
      })
    );
  }
  const parsedRootManifest = parsePackageManifest(
    rootManifestBytes,
    'Downstream'
  );
  if (parsedRootManifest.isErr()) {
    return parsedRootManifest;
  }
  const declaredSpecifier = directSpecifier(
    parsedRootManifest.value,
    params.expected.name
  );
  if (declaredSpecifier.isErr()) {
    return declaredSpecifier;
  }
  if (declaredSpecifier.value === undefined) {
    return Result.err(
      new NotFoundError(
        `Downstream manifest does not directly declare "${params.expected.name}".`,
        { context: { name: params.expected.name, root } }
      )
    );
  }
  const expectedTarballPath =
    params.expected.kind === 'tarball'
      ? resolve(root, params.expected.path)
      : undefined;
  const declarationMatches =
    params.expected.kind === 'published'
      ? declaredSpecifier.value === params.expected.version
      : normalizedTarballDeclaration(root, declaredSpecifier.value) ===
        expectedTarballPath;
  if (!declarationMatches) {
    return Result.err(
      new ConflictError(
        `Downstream declaration for "${params.expected.name}" does not match the selected source.`,
        {
          context: {
            actual: declaredSpecifier.value,
            expected: params.expected,
          },
        }
      )
    );
  }
  const installedRoot = await resolveInstalledPackage(
    root,
    params.expected.name
  );
  return installedRoot.isErr()
    ? installedRoot
    : Result.ok({
        declaredSpecifier: declaredSpecifier.value,
        expectedTarballPath,
        installedRoot: installedRoot.value,
        root,
      });
};
