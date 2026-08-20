import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  expectedTrailsCliReleaseAssetNames,
  trailsCliArchiveName,
  trailsCliChecksumName,
  trailsCliReleasePlatformValues,
} from './cli-bundle.js';
import type { TrailsCliReleasePlatform } from './cli-bundle.js';

export interface GitHubReleaseAsset {
  readonly name: string;
}

export interface GitHubReleaseMetadata {
  readonly assets: readonly GitHubReleaseAsset[];
  readonly draft: boolean;
  readonly published_at: string | null;
  readonly tag_name: string;
}

export type TrailsCliReleaseChecksums = Readonly<
  Record<TrailsCliReleasePlatform, string>
>;

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const checksumPattern = /^[0-9a-f]{64}$/u;

const requireVersion = (version: string): void => {
  if (!versionPattern.test(version)) {
    throw new Error(`Invalid Trails release version: ${version}`);
  }
};

export const validateTrailsHomebrewRelease = (
  release: GitHubReleaseMetadata,
  version: string
): void => {
  requireVersion(version);
  if (release.draft || !release.published_at) {
    throw new Error(`GitHub release v${version} is not published`);
  }
  if (release.tag_name !== `v${version}`) {
    throw new Error(
      `GitHub release tag ${release.tag_name} does not match v${version}`
    );
  }
  for (const expectedName of expectedTrailsCliReleaseAssetNames(version)) {
    const count = release.assets.filter(
      ({ name }) => name === expectedName
    ).length;
    if (count !== 1) {
      throw new Error(
        `Expected exactly one ${expectedName} release asset, found ${count}`
      );
    }
  }
};

export const parseTrailsCliChecksums = (
  contents: string,
  version: string
): TrailsCliReleaseChecksums => {
  requireVersion(version);
  const found = new Map<TrailsCliReleasePlatform, string>();
  for (const line of contents.split('\n').filter(Boolean)) {
    const match = /^(?<checksum>[0-9a-f]{64}) {2}(?<name>.+)$/u.exec(line);
    if (!match?.groups) {
      throw new Error(`Invalid Trails CLI checksum line: ${line}`);
    }
    const platform = trailsCliReleasePlatformValues.find(
      (candidate) =>
        trailsCliArchiveName(version, candidate) === match.groups?.['name']
    );
    if (!platform) {
      throw new Error(
        `Unexpected Trails CLI checksum asset: ${match.groups['name']}`
      );
    }
    if (found.has(platform)) {
      throw new Error(`Duplicate Trails CLI checksum for ${platform}`);
    }
    const parsedChecksum = match.groups['checksum'];
    if (!parsedChecksum) {
      throw new Error(`Missing Trails CLI checksum in line: ${line}`);
    }
    found.set(platform, parsedChecksum);
  }
  for (const platform of trailsCliReleasePlatformValues) {
    if (!found.has(platform)) {
      throw new Error(`Missing Trails CLI checksum for ${platform}`);
    }
  }
  return Object.fromEntries(found) as TrailsCliReleaseChecksums;
};

export const verifyTrailsHomebrewAssetDirectory = async (
  assetsDir: string,
  release: GitHubReleaseMetadata,
  version: string
): Promise<TrailsCliReleaseChecksums> => {
  validateTrailsHomebrewRelease(release, version);
  const checksumPath = join(assetsDir, trailsCliChecksumName(version));
  const checksums = parseTrailsCliChecksums(
    readFileSync(checksumPath, 'utf8'),
    version
  );
  for (const platform of trailsCliReleasePlatformValues) {
    const archiveName = trailsCliArchiveName(version, platform);
    const bytes = await Bun.file(join(assetsDir, archiveName)).bytes();
    const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    if (actual !== checksums[platform]) {
      throw new Error(
        `Checksum mismatch for ${archiveName}: expected ${checksums[platform]}, found ${actual}`
      );
    }
  }
  return checksums;
};

export const renderTrailsHomebrewFormula = (
  version: string,
  checksums: TrailsCliReleaseChecksums
): string => {
  requireVersion(version);
  for (const [platform, checksum] of Object.entries(checksums)) {
    if (!checksumPattern.test(checksum)) {
      throw new Error(`Invalid ${platform} SHA256: ${checksum}`);
    }
  }
  return `class Trails < Formula
  desc "Agent-native, contract-first TypeScript framework"
  homepage "https://github.com/outfitter-dev/trails"
  license "MIT"

  depends_on "bun"

  on_macos do
    on_arm do
      url "https://github.com/outfitter-dev/trails/releases/download/v${version}/trails-v${version}-darwin-arm64.tar.gz"
      sha256 "${checksums['darwin-arm64']}"
    end
    on_intel do
      url "https://github.com/outfitter-dev/trails/releases/download/v${version}/trails-v${version}-darwin-x64.tar.gz"
      sha256 "${checksums['darwin-x64']}"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/outfitter-dev/trails/releases/download/v${version}/trails-v${version}-linux-arm64.tar.gz"
      sha256 "${checksums['linux-arm64']}"
    end
    on_intel do
      url "https://github.com/outfitter-dev/trails/releases/download/v${version}/trails-v${version}-linux-x64.tar.gz"
      sha256 "${checksums['linux-x64']}"
    end
  end

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/trails"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/trails --version")
    assert_match "Usage: trails", shell_output("#{bin}/trails --help")
  end
end
`;
};

const readOption = (args: readonly string[], flag: string): string => {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return value;
};

export const runTrailsHomebrewCli = async (
  args: readonly string[]
): Promise<number> => {
  try {
    const [command, ...options] = args;
    const version = readOption(options, '--version');
    if (command === 'validate') {
      const releasePath = resolve(readOption(options, '--release-json'));
      const assetsDir = resolve(readOption(options, '--assets-dir'));
      const release = JSON.parse(
        readFileSync(releasePath, 'utf8')
      ) as GitHubReleaseMetadata;
      await verifyTrailsHomebrewAssetDirectory(assetsDir, release, version);
      console.log(`Validated Homebrew release assets for v${version}`);
      return 0;
    }
    if (command === 'render') {
      const checksumsPath = resolve(readOption(options, '--checksums'));
      const outputPath = resolve(readOption(options, '--output'));
      const checksums = parseTrailsCliChecksums(
        readFileSync(checksumsPath, 'utf8'),
        version
      );
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(
        outputPath,
        renderTrailsHomebrewFormula(version, checksums)
      );
      console.log(`Rendered ${outputPath}`);
      return 0;
    }
    throw new Error(`Unknown Homebrew release command: ${command ?? '<none>'}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
