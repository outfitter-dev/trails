import { afterEach, describe, expect, test } from 'bun:test';
import { Result } from '@ontrails/core';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import {
  verifyDownstreamPackageSource,
  verifyDownstreamPackageSourceWithAcquirer,
} from '../package-source.js';
import { regradePackageSourceExpectationSchema } from '../package-source-manifest.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const temporaryRoot = (label: string): string => {
  const root = mkdtempSync(join(tmpdir(), `trails-package-source-${label}-`));
  roots.push(root);
  return root;
};

const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const createPackageTarball = (params: {
  readonly exports?: unknown;
  readonly files?: readonly (readonly [string, string])[];
  readonly label: string;
  readonly source: string;
  readonly version?: string;
}): string => {
  const staging = temporaryRoot(`artifact-${params.label}`);
  const packageRoot = join(staging, 'package');
  writeJson(join(packageRoot, 'package.json'), {
    exports: params.exports ?? './index.js',
    name: '@ontrails/core',
    version: params.version ?? '1.0.0',
  });
  writeFileSync(join(packageRoot, 'index.js'), params.source);
  for (const [path, source] of params.files ?? []) {
    writeFileSync(join(packageRoot, path), source);
  }
  const tarball = join(staging, `${params.label}.tgz`);
  const packed = Bun.spawnSync(
    ['tar', '-czf', tarball, '-C', staging, 'package'],
    {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    }
  );
  expect(packed.exitCode).toBe(0);
  return tarball;
};

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const createTraversalTarball = (): string => {
  const root = temporaryRoot('traversal-artifact');
  const header = Buffer.alloc(512);
  header.write('package/../escape.js', 0, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  header.write('0000000\0', 108, 'ascii');
  header.write('0000000\0', 116, 'ascii');
  header.write('00000000001\0', 124, 'ascii');
  header.write('00000000000\0', 136, 'ascii');
  header.fill(0x20, 148, 156);
  header.write('0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  const body = Buffer.concat([
    header,
    Buffer.from('x'),
    Buffer.alloc(511),
    Buffer.alloc(1024),
  ]);
  const path = join(root, 'traversal.tgz');
  writeFileSync(path, Bun.gzipSync(body));
  return path;
};

const createMemberTarball = (
  label: string,
  members: readonly (readonly [string, string, string?])[]
): string => {
  const root = temporaryRoot(`${label}-artifact`);
  const parts: Buffer[] = [];
  for (const [name, contents, type = '0'] of members) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 'utf8');
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(
      `${Buffer.byteLength(contents).toString(8).padStart(11, '0')}\0`,
      124,
      'ascii'
    );
    header.write('00000000000\0', 136, 'ascii');
    header.fill(0x20, 148, 156);
    header.write(type, 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
    const bytes = Buffer.from(contents);
    parts.push(header, bytes, Buffer.alloc(512 - bytes.byteLength));
  }
  parts.push(Buffer.alloc(1024));
  const path = join(root, `${label}.tgz`);
  writeFileSync(path, Bun.gzipSync(Buffer.concat(parts)));
  return path;
};

const createConsumer = (
  tarball: string,
  source: string,
  files: readonly (readonly [string, string])[] = [],
  version = '1.0.0'
): string => {
  const root = temporaryRoot('consumer');
  const locator = relative(root, tarball);
  writeJson(join(root, 'package.json'), {
    dependencies: { '@ontrails/core': `file:${locator}` },
    name: 'consumer',
    version: '1.0.0',
  });
  const installed = join(root, 'node_modules/@ontrails/core');
  writeJson(join(installed, 'package.json'), {
    exports: './index.js',
    name: '@ontrails/core',
    version,
  });
  writeFileSync(join(installed, 'index.js'), source);
  for (const [path, contents] of files) {
    writeFileSync(join(installed, path), contents);
  }
  return root;
};

describe('verifyDownstreamPackageSource', () => {
  test('keeps verifier package identity constraints aligned with the shared schema', async () => {
    const root = temporaryRoot('invalid-expectations');
    const invalidExpectations = [
      {
        kind: 'published',
        name: 'not-ontrails/core',
        version: '1.0.0',
      },
      {
        kind: 'published',
        name: '@ontrails/core',
        version: 'latest',
      },
      ...[
        '01.0.0',
        '1.01.0',
        '1.0.01',
        '1.0.0-01',
        '1.0.0-alpha.01',
        '1.0.0-..',
        '1.0.0-alpha..1',
        '1.0.0-',
        '1.0.0+',
        '1.0.0+build..1',
        '1.0.0-alpha_1',
        '1.0.0\n',
        ' 1.0.0',
        '1.0.0 ',
      ].map((version) => ({
        kind: 'published' as const,
        name: '@ontrails/core' as const,
        version,
      })),
    ] as const;

    for (const expected of invalidExpectations) {
      expect(
        regradePackageSourceExpectationSchema.safeParse(expected).success
      ).toBe(false);
      const result = await verifyDownstreamPackageSource({ expected, root });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.constructor.name).toBe('ValidationError');
      }
    }
  });

  test('accepts exact stable, prerelease, and build package versions', async () => {
    for (const version of [
      '0.0.0',
      '1.2.3',
      '1.0.0-0',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-x-7.z.92',
      '1.0.0+001',
      '1.0.0-alpha.1+build.01',
    ]) {
      expect(
        regradePackageSourceExpectationSchema.safeParse({
          kind: 'published',
          name: '@ontrails/core',
          version,
        }).success
      ).toBe(true);
    }

    const version = '1.0.0-alpha.1+build.01';
    const tarball = createPackageTarball({
      label: 'exact-semver',
      source: 'export const a = 1;\n',
      version,
    });
    const root = createConsumer(tarball, 'export const a = 1;\n', [], version);
    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.version).toBe(version);
    }
  });

  test('rejects malformed versions from matching tarball and installed manifests', async () => {
    const version = '01.0.0';
    const tarball = createPackageTarball({
      label: 'malformed-semver',
      source: 'export const a = 1;\n',
      version,
    });
    const root = createConsumer(tarball, 'export const a = 1;\n', [], version);
    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ValidationError');
      expect(result.error.message).toBe(
        'Selected package artifact has no exact version.'
      );
    }
  });

  test('proves matching tarball declared with a file:./ locator', async () => {
    const tarball = createPackageTarball({
      label: 'dot-slash',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const a = 1;\n');
    const localTarball = join(root, 'vendor', 'core.tgz');
    mkdirSync(dirname(localTarball), { recursive: true });
    copyFileSync(tarball, localTarball);
    writeJson(join(root, 'package.json'), {
      dependencies: { '@ontrails/core': 'file:./vendor/core.tgz' },
      name: 'consumer',
      version: '1.0.0',
    });

    const declaredDotSlash = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: 'vendor/core.tgz',
        sha256: sha256(localTarball),
      },
      root,
    });
    const selectedDotSlash = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: './vendor/core.tgz',
        sha256: sha256(localTarball),
      },
      root,
    });

    expect(declaredDotSlash.isOk()).toBe(true);
    expect(selectedDotSlash.isOk()).toBe(true);
  });

  test('proves matching tarball and installed regular-file bytes', async () => {
    const tarball = createPackageTarball({
      label: 'a',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const a = 1;\n');

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        declaredSpecifier: `file:${relative(root, tarball)}`,
        kind: 'tarball',
        name: '@ontrails/core',
        version: '1.0.0',
      });
      expect(result.value.artifactSha256).toHaveLength(64);
      expect(result.value.contentSha256).toHaveLength(64);
    }
  });

  test('matches an idiomatic dot-slash file declaration by resolved path', async () => {
    const tarball = createPackageTarball({
      label: 'dot-slash',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const a = 1;\n');
    const selectedPath = relative(root, tarball);
    writeJson(join(root, 'package.json'), {
      dependencies: { '@ontrails/core': `file:./${selectedPath}` },
      name: 'consumer',
      version: '1.0.0',
    });

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: selectedPath,
        sha256: sha256(tarball),
      },
      root,
    });
    const selectedDotSlash = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: `./${selectedPath}`,
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isOk()).toBe(true);
    expect(selectedDotSlash.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.declaredSpecifier).toBe(`file:./${selectedPath}`);
    }
  });

  test('resolves a directly installed package without a root export', async () => {
    const tarball = createPackageTarball({
      exports: { './package.json': './package.json' },
      label: 'no-root-export',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const a = 1;\n');
    writeJson(join(root, 'node_modules/@ontrails/core/package.json'), {
      exports: { './package.json': './package.json' },
      name: '@ontrails/core',
      version: '1.0.0',
    });

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isOk()).toBe(true);
  });

  test('anchors proof at the installed package root instead of a matching nested manifest', async () => {
    const tarball = createPackageTarball({
      label: 'nested-matching-manifest',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const root = true;\n');
    const installedRoot = join(root, 'node_modules/@ontrails/core');
    writeJson(join(installedRoot, 'package.json'), {
      exports: { '.': './dist/index.js', './*': './*.js' },
      name: '@ontrails/core',
      version: '1.0.0',
    });
    writeJson(join(installedRoot, 'dist/package.json'), {
      exports: './index.js',
      name: '@ontrails/core',
      version: '1.0.0',
    });
    writeFileSync(
      join(installedRoot, 'dist/index.js'),
      'export const a = 1;\n'
    );
    writeFileSync(
      join(installedRoot, 'extra.js'),
      'export const extra = true;\n'
    );

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ConflictError');
    }
  });

  test('resolves a hoisted symlinked package without a root export', async () => {
    const exports = { './package.json': './package.json' };
    const tarball = createPackageTarball({
      exports,
      label: 'hoisted-symlink',
      source: 'export const a = 1;\n',
    });
    const workspace = temporaryRoot('hoisted-workspace');
    const root = join(workspace, 'apps/consumer');
    const installedRoot = join(workspace, 'store/core');
    writeJson(join(root, 'package.json'), {
      dependencies: {
        '@ontrails/core': `file:${relative(root, tarball)}`,
      },
      name: 'consumer',
      version: '1.0.0',
    });
    writeJson(join(installedRoot, 'package.json'), {
      exports,
      name: '@ontrails/core',
      version: '1.0.0',
    });
    writeFileSync(join(installedRoot, 'index.js'), 'export const a = 1;\n');
    const linkedRoot = join(workspace, 'node_modules/@ontrails/core');
    mkdirSync(dirname(linkedRoot), { recursive: true });
    symlinkSync(installedRoot, linkedRoot, 'dir');

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.resolvedPackagePath).toBe(
        join(realpathSync(workspace), 'node_modules/@ontrails/core')
      );
    }
  });

  test('resolves physical-parent hoisting from a symlinked downstream root', async () => {
    const exports = { './package.json': './package.json' };
    const sourceTarball = createPackageTarball({
      exports,
      label: 'symlink-root-hoist',
      source: 'export const a = 1;\n',
    });
    const workspace = temporaryRoot('symlink-root-workspace');
    const root = join(workspace, 'physical/consumer');
    const tarball = join(root, 'vendor/core.tgz');
    mkdirSync(dirname(tarball), { recursive: true });
    copyFileSync(sourceTarball, tarball);
    writeJson(join(root, 'package.json'), {
      dependencies: { '@ontrails/core': 'file:vendor/core.tgz' },
      name: 'consumer',
      version: '1.0.0',
    });
    const installedRoot = join(
      workspace,
      'physical/node_modules/@ontrails/core'
    );
    writeJson(join(installedRoot, 'package.json'), {
      exports,
      name: '@ontrails/core',
      version: '1.0.0',
    });
    writeFileSync(join(installedRoot, 'index.js'), 'export const a = 1;\n');
    const linkedRoot = join(workspace, 'linked/consumer');
    mkdirSync(dirname(linkedRoot), { recursive: true });
    symlinkSync(root, linkedRoot, 'dir');

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: 'vendor/core.tgz',
        sha256: sha256(tarball),
      },
      root: linkedRoot,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.resolvedPackagePath).toBe(
        realpathSync(installedRoot)
      );
    }
  });

  test('rejects the wrong artifact hash before reading installed bytes', async () => {
    const tarball = createPackageTarball({
      label: 'a',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const a = 1;\n');

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: '0'.repeat(64),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ConflictError');
    }
  });

  test('rejects same-version artifacts whose shipped bytes differ', async () => {
    const tarballA = createPackageTarball({
      label: 'a',
      source: 'export const a = 1;\n',
    });
    const tarballB = createPackageTarball({
      label: 'b',
      source: 'export const b = 2;\n',
    });
    const root = createConsumer(tarballA, 'export const a = 1;\n');
    writeJson(join(root, 'package.json'), {
      dependencies: { '@ontrails/core': `file:${relative(root, tarballB)}` },
      name: 'consumer',
      version: '1.0.0',
    });

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarballB),
        sha256: sha256(tarballB),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ConflictError');
      expect(result.error.message).toContain('bytes do not match');
    }
  });

  test('rejects an extra installed file exported through an artifact wildcard', async () => {
    const exports = {
      '.': './index.js',
      './*': './*.js',
    };
    const tarball = createPackageTarball({
      exports,
      label: 'extra-installed-file',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const a = 1;\n');
    writeJson(join(root, 'node_modules/@ontrails/core/package.json'), {
      exports,
      name: '@ontrails/core',
      version: '1.0.0',
    });
    writeFileSync(
      join(root, 'node_modules/@ontrails/core/extra.js'),
      'export const extra = true;\n'
    );

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ConflictError');
      expect(result.error.message).toContain('not shipped');
      expect(result.error.context).toMatchObject({ path: 'extra.js' });
    }
  });

  test('uses injected published acquisition without live registry access', async () => {
    const tarball = createPackageTarball({
      label: 'published',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const a = 1;\n');
    writeJson(join(root, 'package.json'), {
      dependencies: { '@ontrails/core': '1.0.0' },
      name: 'consumer',
      version: '1.0.0',
    });

    const result = await verifyDownstreamPackageSourceWithAcquirer(
      {
        expected: {
          kind: 'published',
          name: '@ontrails/core',
          version: '1.0.0',
        },
        root,
      },
      {
        acquirePublished: async () => Result.ok(tarball),
      }
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe('published');
    }
  });

  test('rejects published acquisition that normalizes away build metadata', async () => {
    const tarball = createPackageTarball({
      label: 'normalized-published-version',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const a = 1;\n');
    const version = '1.0.0+build.1';
    writeJson(join(root, 'package.json'), {
      dependencies: { '@ontrails/core': version },
      name: 'consumer',
      version: '1.0.0',
    });
    let acquired = false;
    const result = await verifyDownstreamPackageSourceWithAcquirer(
      {
        expected: { kind: 'published', name: '@ontrails/core', version },
        root,
      },
      {
        acquirePublished: async () => {
          acquired = true;
          return Result.ok(tarball);
        },
      }
    );

    expect(acquired).toBe(true);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ConflictError');
      expect(result.error.message).toBe(
        'Package source name or version does not match.'
      );
    }
  });

  test('rejects conflicting direct package-source declarations before acquisition', async () => {
    const root = temporaryRoot('conflicting-declarations');
    writeJson(join(root, 'package.json'), {
      dependencies: { '@ontrails/core': '1.0.0' },
      devDependencies: { '@ontrails/core': '2.0.0' },
      name: 'consumer',
      version: '1.0.0',
    });
    let acquired = false;

    const result = await verifyDownstreamPackageSourceWithAcquirer(
      {
        expected: {
          kind: 'published',
          name: '@ontrails/core',
          version: '1.0.0',
        },
        root,
      },
      {
        acquirePublished: async () => {
          acquired = true;
          throw new Error('Acquisition must not run.');
        },
      }
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ConflictError');
      expect(result.error.message).toContain('conflicting sources');
    }
    expect(acquired).toBe(false);
  });

  test('accepts identical direct declarations across dependency sections', async () => {
    const tarball = createPackageTarball({
      label: 'identical-declarations',
      source: 'export const a = 1;\n',
    });
    const root = createConsumer(tarball, 'export const a = 1;\n');
    const declaredSpecifier = `file:${relative(root, tarball)}`;
    writeJson(join(root, 'package.json'), {
      dependencies: { '@ontrails/core': declaredSpecifier },
      devDependencies: { '@ontrails/core': declaredSpecifier },
      name: 'consumer',
      version: '1.0.0',
    });

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isOk()).toBe(true);
  });

  test('derives one content digest across archive entry creation orders', async () => {
    const files = [
      ['Z.js', 'Z\n'],
      ['a.js', 'a\n'],
      ['m.js', 'm\n'],
    ] as const;
    const tarballA = createPackageTarball({
      files,
      label: 'ordered-a',
      source: 'export {};\n',
    });
    const tarballB = createPackageTarball({
      files: [...files].toReversed(),
      label: 'ordered-b',
      source: 'export {};\n',
    });
    const rootA = createConsumer(tarballA, 'export {};\n', files);
    const rootB = createConsumer(tarballB, 'export {};\n', files);
    const proof = async (root: string, tarball: string) =>
      verifyDownstreamPackageSource({
        expected: {
          kind: 'tarball',
          name: '@ontrails/core',
          path: relative(root, tarball),
          sha256: sha256(tarball),
        },
        root,
      });

    const [first, second] = await Promise.all([
      proof(rootA, tarballA),
      proof(rootB, tarballB),
    ]);

    if (first.isErr()) {
      throw first.error;
    }
    if (second.isErr()) {
      throw second.error;
    }
    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    if (first.isOk() && second.isOk()) {
      expect(first.value.contentSha256).toBe(second.value.contentSha256);
    }
  });

  test('rejects symbolic links in selected artifacts', async () => {
    const staging = temporaryRoot('symlink-artifact');
    const packageRoot = join(staging, 'package');
    writeJson(join(packageRoot, 'package.json'), {
      exports: './index.js',
      name: '@ontrails/core',
      version: '1.0.0',
    });
    writeFileSync(join(packageRoot, 'target.js'), 'export {};\n');
    symlinkSync('target.js', join(packageRoot, 'index.js'));
    const tarball = join(staging, 'symlink.tgz');
    expect(
      Bun.spawnSync(['tar', '-czf', tarball, '-C', staging, 'package'], {
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      }).exitCode
    ).toBe(0);
    const root = createConsumer(tarball, 'export {};\n');

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ValidationError');
      expect(result.error.message).toContain('regular files and directories');
    }
  });

  test('rejects hard links in selected artifacts', async () => {
    const staging = temporaryRoot('hardlink-artifact');
    const packageRoot = join(staging, 'package');
    writeJson(join(packageRoot, 'package.json'), {
      exports: './index.js',
      name: '@ontrails/core',
      version: '1.0.0',
    });
    writeFileSync(join(packageRoot, 'target.js'), 'export {};\n');
    linkSync(join(packageRoot, 'target.js'), join(packageRoot, 'index.js'));
    const tarball = join(staging, 'hardlink.tgz');
    expect(
      Bun.spawnSync(['tar', '-czf', tarball, '-C', staging, 'package'], {
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      }).exitCode
    ).toBe(0);
    const root = createConsumer(tarball, 'export {};\n');

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ValidationError');
      expect(result.error.message).toContain('regular files and directories');
    }
  });

  test('rejects archive member types ignored by the parser', async () => {
    const tarball = createMemberTarball('unsupported-type', [
      ['package/unsupported', '', 'Z'],
    ]);
    const root = createConsumer(tarball, 'export {};\n');

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ValidationError');
      expect(result.error.message).toContain('regular files and directories');
    }
  });

  test('rejects filesystem-equivalent archive paths before extraction', async () => {
    const cases = [
      {
        label: 'case-collision',
        members: [
          ['package/A.js', 'A'],
          ['package/a.js', 'a'],
        ],
      },
      {
        label: 'duplicate-path',
        members: [
          ['package/a.js', 'first'],
          ['package/a.js', 'second'],
        ],
      },
      {
        label: 'unicode-collision',
        members: [
          ['package/\u00E9.js', 'composed'],
          ['package/e\u0301.js', 'decomposed'],
        ],
      },
      {
        label: 'directory-prefix-collision',
        members: [
          ['package/Foo/a.js', 'A'],
          ['package/foo/b.js', 'B'],
        ],
      },
      {
        label: 'long-s-collision',
        members: [
          ['package/s.js', 's'],
          ['package/\u017F.js', 'long-s'],
        ],
      },
      {
        label: 'dotless-i-collision',
        members: [
          ['package/i.js', 'i'],
          ['package/\u0131.js', 'dotless-i'],
        ],
      },
      {
        label: 'final-sigma-collision',
        members: [
          ['package/\u03C3.js', 'sigma'],
          ['package/\u03C2.js', 'final-sigma'],
        ],
      },
      {
        label: 'sharp-s-collision',
        members: [
          ['package/\u00DF.js', 'sharp-s'],
          ['package/\u1E9E.js', 'uppercase-sharp-s'],
        ],
      },
      {
        label: 'unicode-directory-prefix-collision',
        members: [
          ['package/scope/a.js', 's'],
          ['package/\u017Fcope/b.js', 'long-s'],
        ],
      },
      {
        label: 'trailing-dot-collision',
        members: [
          ['package/index.js', 'canonical'],
          ['package/index.js.', 'trailing-dot'],
        ],
      },
      {
        label: 'trailing-space-collision',
        members: [
          ['package/index.js', 'canonical'],
          ['package/index.js ', 'trailing-space-last'],
        ],
      },
    ] as const;

    for (const fixture of cases) {
      const tarball = createMemberTarball(fixture.label, fixture.members);
      const root = createConsumer(tarball, 'export {};\n');
      const result = await verifyDownstreamPackageSource({
        expected: {
          kind: 'tarball',
          name: '@ontrails/core',
          path: relative(root, tarball),
          sha256: sha256(tarball),
        },
        root,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.constructor.name).toBe('ValidationError');
        expect(result.error.message).toContain('filesystem-equivalent');
      }
    }
  });

  test('accepts portable distinct Unicode archive paths', async () => {
    const files = [
      ['\u03BB.js', 'export const lambda = true;\n'],
      ['\u0436.js', 'export const zhe = true;\n'],
    ] as const;
    const tarball = createPackageTarball({
      files,
      label: 'distinct-unicode-paths',
      source: 'export {};\n',
    });
    const root = createConsumer(tarball, 'export {};\n', files);

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isOk()).toBe(true);
  });

  test('accepts actual Unicode member names when the process locale is C', async () => {
    const files = [['\u00E9.js', 'export const cafe = true;\n']] as const;
    const tarball = createPackageTarball({
      files,
      label: 'c-locale-unicode-path',
      source: 'export {};\n',
    });
    const root = createConsumer(tarball, 'export {};\n', files);
    const priorLocale = process.env.LC_ALL;
    process.env.LC_ALL = 'C';
    try {
      const result = await verifyDownstreamPackageSource({
        expected: {
          kind: 'tarball',
          name: '@ontrails/core',
          path: relative(root, tarball),
          sha256: sha256(tarball),
        },
        root,
      });

      expect(result.isOk()).toBe(true);
    } finally {
      if (priorLocale === undefined) {
        delete process.env.LC_ALL;
      } else {
        process.env.LC_ALL = priorLocale;
      }
    }
  });

  test('rejects Windows-incompatible archive path segments before extraction', async () => {
    const cases = [
      ['trailing-file-space-last', 'package/index.js '],
      ['trailing-directory-dot', 'package/cache./index.js'],
      ['trailing-directory-space', 'package/cache /index.js'],
      ['reserved-device-file', 'package/CON.js'],
      ['reserved-device-directory', 'package/aux/index.js'],
      ['reserved-superscript-device', 'package/COM\u00B9.txt'],
      ['alternate-data-stream', 'package/index.js:stream'],
      ['reserved-character', 'package/index?.js'],
      ['control-character', 'package/index\u0001.js'],
      ['newline-character', 'package/index\n.js'],
      ['backslash-character', 'package/cache\\index.js'],
    ] as const;

    for (const [label, path] of cases) {
      const tarball = createMemberTarball(label, [[path, 'unsafe']]);
      const root = createConsumer(tarball, 'export {};\n');
      const result = await verifyDownstreamPackageSource({
        expected: {
          kind: 'tarball',
          name: '@ontrails/core',
          path: relative(root, tarball),
          sha256: sha256(tarball),
        },
        root,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.constructor.name).toBe('ValidationError');
        expect(result.error.message).toContain('unsafe');
      }
    }
  });

  test('rejects dot-segment aliases before archive extraction', async () => {
    const manifest = `${JSON.stringify({ exports: './index.js', name: '@ontrails/core', version: '1.0.0' })}\n`;
    const tarball = createMemberTarball('dot-segment-alias', [
      ['package/package.json', manifest],
      ['package/index.js', 'export const value = "canonical";\n'],
      ['package/./index.js', 'export const value = "alias";\n'],
    ]);
    const root = createConsumer(tarball, 'export const value = "canonical";\n');

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ValidationError');
      expect(result.error.message).toContain('unsafe');
    }
  });

  test('returns ValidationError for malformed manifests and artifacts', async () => {
    const malformedManifestRoot = temporaryRoot('malformed-manifest');
    writeFileSync(join(malformedManifestRoot, 'package.json'), 'null\n');
    const manifestResult = await verifyDownstreamPackageSource({
      expected: {
        kind: 'published',
        name: '@ontrails/core',
        version: '1.0.0',
      },
      root: malformedManifestRoot,
    });
    expect(manifestResult.isErr()).toBe(true);
    if (manifestResult.isErr()) {
      expect(manifestResult.error.constructor.name).toBe('ValidationError');
    }

    const malformedTarball = join(
      temporaryRoot('malformed-artifact'),
      'bad.tgz'
    );
    writeFileSync(malformedTarball, 'not a tarball');
    const root = createConsumer(malformedTarball, 'export {};\n');
    const artifactResult = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, malformedTarball),
        sha256: sha256(malformedTarball),
      },
      root,
    });
    expect(artifactResult.isErr()).toBe(true);
    if (artifactResult.isErr()) {
      expect(artifactResult.error.constructor.name).toBe('ValidationError');
    }
  });

  test('returns ValidationError for malformed selected and installed manifests', async () => {
    const malformedSelected = createPackageTarball({
      label: 'malformed-selected',
      source: 'export {};\n',
    });
    writeFileSync(
      join(dirname(malformedSelected), 'package/package.json'),
      '[]\n'
    );
    expect(
      Bun.spawnSync([
        'tar',
        '-czf',
        malformedSelected,
        '-C',
        dirname(malformedSelected),
        'package',
      ]).exitCode
    ).toBe(0);
    const selectedRoot = createConsumer(malformedSelected, 'export {};\n');
    const selectedResult = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(selectedRoot, malformedSelected),
        sha256: sha256(malformedSelected),
      },
      root: selectedRoot,
    });
    expect(selectedResult.isErr()).toBe(true);
    if (selectedResult.isErr()) {
      expect(selectedResult.error.constructor.name).toBe('ValidationError');
    }

    const validTarball = createPackageTarball({
      label: 'malformed-installed',
      source: 'export {};\n',
    });
    const installedRoot = createConsumer(validTarball, 'export {};\n');
    writeFileSync(
      join(installedRoot, 'node_modules/@ontrails/core/package.json'),
      'null\n'
    );
    const installedResult = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(installedRoot, validTarball),
        sha256: sha256(validTarball),
      },
      root: installedRoot,
    });
    expect(installedResult.isErr()).toBe(true);
    if (installedResult.isErr()) {
      expect(installedResult.error.constructor.name).toBe('ValidationError');
    }
  });

  test('rejects parent traversal archive members before extraction', async () => {
    const tarball = createTraversalTarball();
    const root = createConsumer(tarball, 'export {};\n');

    const result = await verifyDownstreamPackageSource({
      expected: {
        kind: 'tarball',
        name: '@ontrails/core',
        path: relative(root, tarball),
        sha256: sha256(tarball),
      },
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.constructor.name).toBe('ValidationError');
    }
    expect(existsSync(join(root, 'escape.js'))).toBe(false);
  });
});
