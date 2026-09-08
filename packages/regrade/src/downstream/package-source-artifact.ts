import {
  ConflictError,
  InternalError,
  NotFoundError,
  Result,
  ValidationError,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { extract, Parser } from 'tar';
import type { ReadEntry } from 'tar';

import type {
  RegradePackageSourceError,
  RegradePackageSourceExpectation,
} from './package-source.js';

const errorCause = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

export interface PackageSourceArtifactAcquirer {
  readonly acquirePublished: (params: {
    readonly destination: string;
    readonly name: string;
    readonly root: string;
    readonly version: string;
  }) => Promise<TrailsResult<string, RegradePackageSourceError>>;
}

const runProcess = async (
  command: readonly string[],
  cwd?: string
): Promise<TrailsResult<string, InternalError>> => {
  try {
    const proc = Bun.spawn(command as string[], {
      ...(cwd === undefined ? {} : { cwd }),
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (exitCode !== 0) {
      return Result.err(
        new InternalError(`Package artifact command failed: ${command[0]}`, {
          context: { command, exitCode, stderr: stderr.trim() },
        })
      );
    }
    return Result.ok(stdout);
  } catch (error) {
    return Result.err(
      new InternalError(`Package artifact command failed: ${command[0]}`, {
        cause: errorCause(error),
        context: { command },
      })
    );
  }
};

export const defaultArtifactAcquirer: PackageSourceArtifactAcquirer = {
  acquirePublished: async ({ destination, name, root, version }) => {
    const packed = await runProcess(
      [
        'npm',
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        destination,
        `${name}@${version}`,
      ],
      root
    );
    if (packed.isErr()) {
      const stderr = packed.error.context?.['stderr'];
      return typeof stderr === 'string' &&
        /(?:E404|ETARGET|no matching version found|not found)/iu.test(stderr)
        ? Result.err(
            new NotFoundError(
              `Published package ${name}@${version} was not found.`,
              {
                cause: packed.error,
              }
            )
          )
        : packed;
    }
    try {
      const parsed = JSON.parse(packed.value) as readonly {
        filename?: string;
      }[];
      const filename = parsed[0]?.filename;
      if (filename === undefined || filename !== basename(filename)) {
        return Result.err(
          new InternalError(
            `npm pack returned no safe artifact name for ${name}@${version}.`
          )
        );
      }
      return Result.ok(join(destination, filename));
    } catch (error) {
      return Result.err(
        new InternalError(
          `npm pack returned invalid output for ${name}@${version}.`,
          {
            cause: errorCause(error),
          }
        )
      );
    }
  },
};

const windowsDeviceNamePattern =
  /^(?:aux|con|nul|prn|com[1-9\u00B9\u00B2\u00B3]|lpt[1-9\u00B9\u00B2\u00B3])(?:\.|$)/iu;

const archiveSegmentIsPortable = (segment: string): boolean =>
  !/[<>:"\\|?*]/u.test(segment) &&
  ![...segment].some(
    (character) => (character.codePointAt(0) ?? Number.POSITIVE_INFINITY) <= 31
  ) &&
  !/[ .]$/u.test(segment) &&
  !windowsDeviceNamePattern.test(segment);

const archivePathIsSafe = (path: string): boolean =>
  path.startsWith('package/') &&
  !path.includes('\\') &&
  !path.includes('\0') &&
  !isAbsolute(path) &&
  path
    .replace(/\/$/u, '')
    .split('/')
    .every(
      (segment) =>
        segment !== '.' &&
        segment !== '..' &&
        segment !== '' &&
        archiveSegmentIsPortable(segment)
    );

const archiveRawHeaderPathIsPortable = (path: string): boolean =>
  !path.includes('\\') && !path.includes('\0');

// Default Unicode mappings make archive collisions visible without depending
// on the host filesystem's case behavior or locale.
const portableCaseCollisionKey = (value: string): string =>
  value.normalize('NFC').toLowerCase().toUpperCase().normalize('NFC');

const archivePathsArePortable = (paths: readonly string[]): boolean => {
  const exactPaths = new Set<string>();
  const foldedPrefixes = new Map<string, string>();
  for (const path of paths) {
    const normalizedPath = path.replace(/\/$/u, '').normalize('NFC');
    if (exactPaths.has(normalizedPath)) {
      return false;
    }
    exactPaths.add(normalizedPath);
    const segments = normalizedPath.split('/');
    for (let index = 0; index < segments.length; index += 1) {
      const exactPrefix = segments.slice(0, index + 1).join('/');
      const foldedPrefix = portableCaseCollisionKey(exactPrefix);
      const prior = foldedPrefixes.get(foldedPrefix);
      if (prior !== undefined && prior !== exactPrefix) {
        return false;
      }
      foldedPrefixes.set(foldedPrefix, exactPrefix);
    }
  }
  return true;
};

interface ArchiveEntry {
  readonly path: string;
  readonly rawHeaderPath: string | undefined;
  readonly type: string;
}

const readArchiveEntries = async (
  tarballPath: string
): Promise<TrailsResult<readonly ArchiveEntry[], ValidationError>> => {
  const entries: ArchiveEntry[] = [];
  try {
    const recordEntry = (entry: ReadEntry): void => {
      entries.push({
        path: entry.path,
        rawHeaderPath: entry.header.path,
        type: entry.type,
      });
      entry.resume();
    };
    // Parser exposes entries that the higher-level list command omits, so an
    // unsupported member type cannot disappear from the admission check.
    const parser = new Parser({ onReadEntry: recordEntry, strict: true });
    parser.on('ignoredEntry', recordEntry);
    const artifact = await readFile(tarballPath);
    const finished = once(parser, 'end');
    parser.end(artifact);
    await finished;
    return Result.ok(entries);
  } catch (error) {
    return Result.err(
      new ValidationError('Selected package artifact is malformed.', {
        cause: errorCause(error),
        context: { tarballPath },
      })
    );
  }
};

export const extractPackageArtifact = async (
  tarballPath: string,
  destination: string
): Promise<TrailsResult<string, RegradePackageSourceError>> => {
  const archiveEntries = await readArchiveEntries(tarballPath);
  if (archiveEntries.isErr()) {
    return archiveEntries;
  }
  const entries = archiveEntries.value.map((entry) => entry.path);
  if (
    entries.length === 0 ||
    archiveEntries.value.some(
      (entry) =>
        !archivePathIsSafe(entry.path) ||
        (entry.rawHeaderPath !== undefined &&
          !archiveRawHeaderPathIsPortable(entry.rawHeaderPath))
    ) ||
    !archivePathsArePortable(entries)
  ) {
    return Result.err(
      new ValidationError(
        'Package artifact contains an unsafe or filesystem-equivalent archive path.',
        { context: { tarballPath } }
      )
    );
  }
  if (
    archiveEntries.value.some(
      (entry) =>
        entry.type !== 'File' &&
        entry.type !== 'OldFile' &&
        entry.type !== 'Directory'
    )
  ) {
    return Result.err(
      new ValidationError(
        'Package artifact may contain only regular files and directories.',
        { context: { tarballPath } }
      )
    );
  }
  await mkdir(destination, { recursive: true });
  try {
    await extract({
      cwd: destination,
      file: tarballPath,
      noChmod: true,
      preserveOwner: false,
      strict: true,
    });
    return Result.ok(join(destination, 'package'));
  } catch (error) {
    return Result.err(
      new ValidationError('Selected package artifact is malformed.', {
        cause: errorCause(error),
        context: { tarballPath },
      })
    );
  }
};

export interface SelectedArtifactSnapshot {
  readonly artifactSha256: string;
  readonly originalPath: string;
  readonly snapshotPath: string;
}

export const revalidateSelectedArtifact = async (
  artifact: SelectedArtifactSnapshot
): Promise<TrailsResult<void, ConflictError | InternalError>> => {
  try {
    const currentArtifactSha256 = sha256(await readFile(artifact.originalPath));
    return currentArtifactSha256 === artifact.artifactSha256
      ? Result.ok()
      : Result.err(
          new ConflictError('Selected package artifact changed during proof.', {
            context: {
              actual: currentArtifactSha256,
              expected: artifact.artifactSha256,
            },
          })
        );
  } catch (error) {
    return Result.err(
      new InternalError('Selected package artifact could not be revalidated.', {
        cause: errorCause(error),
        context: { path: artifact.originalPath },
      })
    );
  }
};

export const snapshotSelectedArtifact = async (params: {
  readonly acquirer: PackageSourceArtifactAcquirer;
  readonly expected: RegradePackageSourceExpectation;
  readonly expectedTarballPath: string | undefined;
  readonly root: string;
  readonly tempRoot: string;
}): Promise<
  TrailsResult<SelectedArtifactSnapshot, RegradePackageSourceError>
> => {
  let selected: TrailsResult<string, RegradePackageSourceError>;
  if (params.expected.kind === 'published') {
    selected = await params.acquirer.acquirePublished({
      destination: params.tempRoot,
      name: params.expected.name,
      root: params.root,
      version: params.expected.version,
    });
  } else if (params.expectedTarballPath === undefined) {
    selected = Result.err(
      new InternalError('Tarball package-source path was not resolved.')
    );
  } else {
    selected = Result.ok(params.expectedTarballPath);
  }
  if (selected.isErr()) {
    return selected;
  }
  let tarballBytes: Uint8Array;
  try {
    tarballBytes = await readFile(selected.value);
  } catch (error) {
    return Result.err(
      new NotFoundError('Selected package artifact was not found.', {
        cause: errorCause(error),
        context: { path: selected.value },
      })
    );
  }
  const artifactSha256 = sha256(tarballBytes);
  if (
    params.expected.kind === 'tarball' &&
    artifactSha256 !== params.expected.sha256
  ) {
    return Result.err(
      new ConflictError('Selected package artifact hash does not match.', {
        context: { actual: artifactSha256, expected: params.expected.sha256 },
      })
    );
  }
  const snapshotPath = join(params.tempRoot, 'selected-package.tgz');
  try {
    await writeFile(snapshotPath, tarballBytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    return Result.err(
      new InternalError('Selected package artifact could not be snapshotted.', {
        cause: errorCause(error),
      })
    );
  }
  return Result.ok({
    artifactSha256,
    originalPath: selected.value,
    snapshotPath,
  });
};
