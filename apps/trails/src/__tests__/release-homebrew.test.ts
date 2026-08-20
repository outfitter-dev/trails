import { describe, expect, test } from 'bun:test';

import {
  parseTrailsCliChecksums,
  renderTrailsHomebrewFormula,
  validateTrailsHomebrewRelease,
} from '../release/homebrew.js';
import type { GitHubReleaseMetadata } from '../release/homebrew.js';
import { expectedTrailsCliReleaseAssetNames } from '../release/cli-bundle.js';

const version = '1.2.3-beta.4';
const checksum = 'a'.repeat(64);
const checksumFile = expectedTrailsCliReleaseAssetNames(version)
  .filter((name) => name.endsWith('.tar.gz'))
  .map((name) => `${checksum}  ${name}`)
  .join('\n');
const release = {
  assets: expectedTrailsCliReleaseAssetNames(version).map((name) => ({ name })),
  draft: false,
  published_at: '2026-08-11T12:00:00Z',
  tag_name: `v${version}`,
} satisfies GitHubReleaseMetadata;

describe('Trails Homebrew release handoff', () => {
  test('requires one of every expected asset on a published release', () => {
    const firstAsset = release.assets.at(0);
    if (!firstAsset) {
      throw new Error('Expected a release fixture asset');
    }
    expect(() => validateTrailsHomebrewRelease(release, version)).not.toThrow();
    expect(() =>
      validateTrailsHomebrewRelease({ ...release, draft: true }, version)
    ).toThrow('is not published');
    expect(() =>
      validateTrailsHomebrewRelease(
        { ...release, assets: release.assets.slice(1) },
        version
      )
    ).toThrow('found 0');
    expect(() =>
      validateTrailsHomebrewRelease(
        { ...release, assets: [...release.assets, firstAsset] },
        version
      )
    ).toThrow('found 2');
  });

  test('parses a complete checksum manifest and rejects duplicate entries', () => {
    expect(parseTrailsCliChecksums(`${checksumFile}\n`, version)).toEqual({
      'darwin-arm64': checksum,
      'darwin-x64': checksum,
      'linux-arm64': checksum,
      'linux-x64': checksum,
    });
    expect(() =>
      parseTrailsCliChecksums(
        `${checksumFile}\n${checksumFile.split('\n')[0]}\n`,
        version
      )
    ).toThrow('Duplicate Trails CLI checksum');
  });

  test('renders a four-platform formula that installs the full Bun bundle', () => {
    const formula = renderTrailsHomebrewFormula(
      version,
      parseTrailsCliChecksums(checksumFile, version)
    );
    expect(formula).toContain('license "MIT"');
    expect(formula).toContain('depends_on "bun"');
    expect(formula).toContain('trails-v#{version}-darwin-arm64.tar.gz');
    expect(formula).toContain('trails-v#{version}-darwin-x64.tar.gz');
    expect(formula).toContain('trails-v#{version}-linux-arm64.tar.gz');
    expect(formula).toContain('trails-v#{version}-linux-x64.tar.gz');
    expect(formula).toContain('libexec.install Dir["*"]');
    expect(formula).toContain('bin.install_symlink libexec/"bin/trails"');
    expect(formula).toContain('shell_output("#{bin}/trails --version")');
    expect(formula).toContain('shell_output("#{bin}/trails --help")');
  });
});
