import {
  ConflictError,
  InternalError,
  Result,
  ValidationError,
} from '@ontrails/core';
import type { Result as TrailsResult, NotFoundError } from '@ontrails/core';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  defaultArtifactAcquirer,
  extractPackageArtifact,
  revalidateSelectedArtifact,
  snapshotSelectedArtifact,
} from './package-source-artifact.js';
import type { PackageSourceArtifactAcquirer } from './package-source-artifact.js';
import {
  collectRegularFiles,
  compareInstalledFiles,
} from './package-source-files.js';
import {
  exactVersionPattern,
  parsePackageManifest,
  preparePackageSource,
} from './package-source-manifest.js';
import type { PackageManifest } from './package-source-manifest.js';

const errorCause = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export type RegradePackageSourceExpectation =
  | {
      readonly kind: 'published';
      readonly name: string;
      readonly version: string;
    }
  | {
      readonly kind: 'tarball';
      readonly name: string;
      readonly path: string;
      readonly sha256: string;
    };

export interface RegradePackageSourceEvidence {
  readonly kind: RegradePackageSourceExpectation['kind'];
  readonly name: string;
  readonly version: string;
  readonly declaredSpecifier: string;
  readonly resolvedPackagePath: string;
  readonly artifactSha256: string;
  readonly contentSha256: string;
}

export type RegradePackageSourceError =
  | ConflictError
  | InternalError
  | NotFoundError
  | ValidationError;

/**
 * Test seam for deterministic published-artifact fixtures.
 *
 * @internal
 */
export const verifyDownstreamPackageSourceWithAcquirer = async (
  params: {
    readonly root: string;
    readonly expected: RegradePackageSourceExpectation;
  },
  acquirer: PackageSourceArtifactAcquirer
): Promise<
  TrailsResult<RegradePackageSourceEvidence, RegradePackageSourceError>
> => {
  const prepared = await preparePackageSource(params);
  if (prepared.isErr()) {
    return prepared;
  }
  let tempRoot: string;
  try {
    tempRoot = await mkdtemp(join(tmpdir(), 'trails-regrade-package-source-'));
  } catch (error) {
    return Result.err(
      new InternalError(
        'Package source proof workspace could not be created.',
        {
          cause: errorCause(error),
        }
      )
    );
  }
  try {
    const artifact = await snapshotSelectedArtifact({
      acquirer,
      expected: params.expected,
      expectedTarballPath: prepared.value.expectedTarballPath,
      root: prepared.value.root,
      tempRoot,
    });
    if (artifact.isErr()) {
      return artifact;
    }
    const extracted = await extractPackageArtifact(
      artifact.value.snapshotPath,
      join(tempRoot, 'extracted')
    );
    if (extracted.isErr()) {
      return extracted;
    }
    const revalidated = await revalidateSelectedArtifact(artifact.value);
    if (revalidated.isErr()) {
      return revalidated;
    }
    let artifactManifest: PackageManifest;
    let installedManifest: PackageManifest;
    try {
      const [artifactManifestBytes, installedManifestBytes] = await Promise.all(
        [
          readFile(join(extracted.value, 'package.json'), 'utf8'),
          readFile(join(prepared.value.installedRoot, 'package.json'), 'utf8'),
        ]
      );
      const artifactParsed = parsePackageManifest(
        artifactManifestBytes,
        'Selected artifact'
      );
      if (artifactParsed.isErr()) {
        return artifactParsed;
      }
      const installedParsed = parsePackageManifest(
        installedManifestBytes,
        'Installed'
      );
      if (installedParsed.isErr()) {
        return installedParsed;
      }
      artifactManifest = artifactParsed.value;
      installedManifest = installedParsed.value;
    } catch (error) {
      return Result.err(
        new ValidationError(
          'Package source manifest is malformed or missing.',
          {
            cause: errorCause(error),
          }
        )
      );
    }
    const selectedVersion =
      params.expected.kind === 'published'
        ? params.expected.version
        : artifactManifest.version;
    if (
      artifactManifest.name !== params.expected.name ||
      artifactManifest.version !== selectedVersion ||
      installedManifest.name !== params.expected.name ||
      installedManifest.version !== selectedVersion
    ) {
      return Result.err(
        new ConflictError('Package source name or version does not match.', {
          context: {
            artifact: {
              name: artifactManifest.name,
              version: artifactManifest.version,
            },
            installed: {
              name: installedManifest.name,
              version: installedManifest.version,
            },
            selected: { name: params.expected.name, version: selectedVersion },
          },
        })
      );
    }
    if (
      selectedVersion === undefined ||
      !exactVersionPattern.test(selectedVersion)
    ) {
      return Result.err(
        new ValidationError('Selected package artifact has no exact version.')
      );
    }
    const artifactFiles = await collectRegularFiles(extracted.value);
    if (artifactFiles.isErr()) {
      return artifactFiles;
    }
    const matched = await compareInstalledFiles(
      artifactFiles.value,
      prepared.value.installedRoot
    );
    if (matched.isErr()) {
      return matched;
    }
    return Result.ok({
      artifactSha256: artifact.value.artifactSha256,
      contentSha256: matched.value,
      declaredSpecifier: prepared.value.declaredSpecifier,
      kind: params.expected.kind,
      name: params.expected.name,
      resolvedPackagePath: prepared.value.installedRoot,
      version: selectedVersion,
    });
  } catch (error) {
    return Result.err(
      new InternalError('Package source proof failed unexpectedly.', {
        cause: errorCause(error),
      })
    );
  } finally {
    try {
      await rm(tempRoot, { force: true, recursive: true });
    } catch {
      // Cleanup must not replace the proof result or its specific error.
    }
  }
};

/**
 * Prove that one installed downstream package matches an explicitly selected
 * published or local tarball artifact, without changing the target project.
 *
 * @example
 * ```ts
 * const proof = await verifyDownstreamPackageSource({
 *   expected: { kind: 'published', name: '@ontrails/core', version: '1.0.0' },
 *   root: process.cwd(),
 * });
 * if (proof.isErr()) throw proof.error;
 * ```
 */
export const verifyDownstreamPackageSource = async (params: {
  readonly root: string;
  readonly expected: RegradePackageSourceExpectation;
}): Promise<
  TrailsResult<RegradePackageSourceEvidence, RegradePackageSourceError>
> => verifyDownstreamPackageSourceWithAcquirer(params, defaultArtifactAcquirer);
