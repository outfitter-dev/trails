import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildTrailsCliReleaseArtifact,
  createDeterministicTarGzip,
  currentTrailsCliReleasePlatform,
  expectedTrailsCliReleaseAssetNames,
  trailsCliArchiveName,
  trailsCliChecksumName,
  trailsCliReleasePlatforms,
} from '../release/cli-bundle.js';

describe('Trails CLI release bundle', () => {
  test('maps each supported platform to exactly matching OXC bindings', () => {
    expect(trailsCliReleasePlatforms).toEqual([
      {
        oxcParserBinding: '@oxc-parser/binding-darwin-arm64',
        oxcResolverBinding: '@oxc-resolver/binding-darwin-arm64',
        platform: 'darwin-arm64',
      },
      {
        oxcParserBinding: '@oxc-parser/binding-darwin-x64',
        oxcResolverBinding: '@oxc-resolver/binding-darwin-x64',
        platform: 'darwin-x64',
      },
      {
        oxcParserBinding: '@oxc-parser/binding-linux-arm64-gnu',
        oxcResolverBinding: '@oxc-resolver/binding-linux-arm64-gnu',
        platform: 'linux-arm64',
      },
      {
        oxcParserBinding: '@oxc-parser/binding-linux-x64-gnu',
        oxcResolverBinding: '@oxc-resolver/binding-linux-x64-gnu',
        platform: 'linux-x64',
      },
    ]);
  });

  test('uses stable archive and checksum names', () => {
    expect(trailsCliArchiveName('1.2.3-beta.4', 'linux-arm64')).toBe(
      'trails-v1.2.3-beta.4-linux-arm64.tar.gz'
    );
    expect(trailsCliChecksumName('1.2.3-beta.4')).toBe(
      'trails-v1.2.3-beta.4-SHA256SUMS'
    );
    expect(expectedTrailsCliReleaseAssetNames('1.2.3')).toEqual([
      'trails-v1.2.3-darwin-arm64.tar.gz',
      'trails-v1.2.3-darwin-x64.tar.gz',
      'trails-v1.2.3-linux-arm64.tar.gz',
      'trails-v1.2.3-linux-x64.tar.gz',
      'trails-v1.2.3-SHA256SUMS',
    ]);
  });

  test('writes deterministic archives with stable modes and ordering', () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-archive-test-'));
    try {
      mkdirSync(join(root, 'bin'), { recursive: true });
      mkdirSync(join(root, 'lib'), { recursive: true });
      writeFileSync(join(root, 'lib/trails.js'), 'console.log("trails");\n');
      writeFileSync(join(root, 'bin/trails'), '#!/bin/sh\n');
      chmodSync(join(root, 'bin/trails'), 0o755);
      const first = createDeterministicTarGzip(root, 'trails-v1.2.3-test');
      const second = createDeterministicTarGzip(root, 'trails-v1.2.3-test');
      expect(first).toEqual(second);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('builds a cold-startable host bundle with only matching bindings', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'trails-release-test-'));
    try {
      const artifact = await buildTrailsCliReleaseArtifact({ outDir });
      expect(artifact.platform).toBe(currentTrailsCliReleasePlatform());
      const listing = Bun.spawnSync(['tar', '-tzf', artifact.archivePath]);
      expect(listing.exitCode).toBe(0);
      const files = new TextDecoder().decode(listing.stdout);
      expect(files).toContain('/lib/app.js');
      expect(files).toContain('/lib/trails.js');
      const descriptor = trailsCliReleasePlatforms.find(
        ({ platform }) => platform === artifact.platform
      );
      expect(files).toContain('/node_modules/oxc-parser/package.json');
      expect(files).toContain('/node_modules/oxc-resolver/package.json');
      expect(files).toContain(`/node_modules/${descriptor?.oxcParserBinding}/`);
      expect(files).toContain(
        `/node_modules/${descriptor?.oxcResolverBinding}/`
      );
      const parserBindings = new Set(
        [
          ...files.matchAll(
            /node_modules\/@oxc-parser\/(?<name>binding-[^/]+)\//gu
          ),
        ].map((match) => match.groups?.name)
      );
      const resolverBindings = new Set(
        [
          ...files.matchAll(
            /node_modules\/@oxc-resolver\/(?<name>binding-[^/]+)\//gu
          ),
        ].map((match) => match.groups?.name)
      );
      expect(parserBindings).toEqual(
        new Set([descriptor?.oxcParserBinding.replace('@oxc-parser/', '')])
      );
      expect(resolverBindings).toEqual(
        new Set([descriptor?.oxcResolverBinding.replace('@oxc-resolver/', '')])
      );
    } finally {
      rmSync(outDir, { force: true, recursive: true });
    }
  }, 30_000);
});
