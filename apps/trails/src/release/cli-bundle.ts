import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

export const trailsCliReleasePlatformValues = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
] as const;

export type TrailsCliReleasePlatform =
  (typeof trailsCliReleasePlatformValues)[number];

export interface TrailsCliReleasePlatformDescriptor {
  readonly oxcParserBinding: string;
  readonly oxcResolverBinding: string;
  readonly platform: TrailsCliReleasePlatform;
}

export const trailsCliReleasePlatforms = [
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
] as const satisfies readonly TrailsCliReleasePlatformDescriptor[];

export interface BuildTrailsCliReleaseOptions {
  readonly outDir: string;
  readonly platform?: TrailsCliReleasePlatform;
  readonly repoRoot?: string;
  readonly version?: string;
}

export interface TrailsCliReleaseArtifact {
  readonly archiveName: string;
  readonly archivePath: string;
  readonly checksum: string;
  readonly checksumPath: string;
  readonly platform: TrailsCliReleasePlatform;
  readonly version: string;
}

const DEFAULT_REPO_ROOT = resolve(import.meta.dir, '../../../..');
const textDecoder = new TextDecoder();
const BUNDLE_EXTERNALS = ['oxc-parser', 'oxc-resolver'] as const;

const platformDescriptor = (
  platform: TrailsCliReleasePlatform
): TrailsCliReleasePlatformDescriptor => {
  const descriptor = trailsCliReleasePlatforms.find(
    (candidate) => candidate.platform === platform
  );
  if (!descriptor) {
    throw new Error(`Unsupported Trails CLI release platform: ${platform}`);
  }
  return descriptor;
};

export const currentTrailsCliReleasePlatform = (
  platform = process.platform,
  architecture = process.arch
): TrailsCliReleasePlatform => {
  const candidate = `${platform}-${architecture}`;
  if (
    trailsCliReleasePlatformValues.includes(
      candidate as TrailsCliReleasePlatform
    )
  ) {
    return candidate as TrailsCliReleasePlatform;
  }
  throw new Error(`Unsupported Trails CLI release host: ${candidate}`);
};

export const trailsCliArchiveName = (
  version: string,
  platform: TrailsCliReleasePlatform
): string => `trails-v${version}-${platform}.tar.gz`;

export const trailsCliChecksumName = (version: string): string =>
  `trails-v${version}-SHA256SUMS`;

export const expectedTrailsCliReleaseAssetNames = (
  version: string
): readonly string[] => [
  ...trailsCliReleasePlatformValues.map((platform) =>
    trailsCliArchiveName(version, platform)
  ),
  trailsCliChecksumName(version),
];

const findPackageRoot = (entryPath: string, expectedName: string): string => {
  let candidate = dirname(entryPath);
  while (candidate !== dirname(candidate)) {
    const packagePath = join(candidate, 'package.json');
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        name?: string;
      };
      if (packageJson.name === expectedName) {
        return candidate;
      }
    }
    candidate = dirname(candidate);
  }
  throw new Error(`Could not locate package root for ${expectedName}`);
};

const resolvePackageRoot = (
  packageName: string,
  fromDirectory: string
): string =>
  findPackageRoot(Bun.resolveSync(packageName, fromDirectory), packageName);

const copyPackage = (
  packageName: string,
  sourceRoot: string,
  bundleRoot: string
): { readonly name: string; readonly version: string } => {
  const scope = packageName.startsWith('@') ? packageName.split('/')[0] : null;
  const target = join(bundleRoot, 'node_modules', packageName);
  if (scope) {
    mkdirSync(join(bundleRoot, 'node_modules', scope), { recursive: true });
  }
  cpSync(sourceRoot, target, { dereference: true, recursive: true });
  const packageJson = JSON.parse(
    readFileSync(join(sourceRoot, 'package.json'), 'utf8')
  ) as { name?: string; version?: string };
  if (packageJson.name !== packageName || !packageJson.version) {
    throw new Error(`Invalid package metadata for ${packageName}`);
  }
  return { name: packageName, version: packageJson.version };
};

const launcherSource = `#!/bin/sh
set -eu

source_path=$0
while [ -L "$source_path" ]; do
  source_dir=$(CDPATH= cd -P -- "$(dirname -- "$source_path")" && pwd)
  source_path=$(readlink "$source_path")
  case $source_path in
    /*) ;;
    *) source_path=$source_dir/$source_path ;;
  esac
done
source_dir=$(CDPATH= cd -P -- "$(dirname -- "$source_path")" && pwd)
exec bun "$source_dir/../lib/trails.js" "$@"
`;

interface ArchiveEntry {
  readonly bytes: Buffer;
  readonly mode: number;
  readonly path: string;
}

const collectArchiveEntries = (
  rootDir: string,
  archiveRoot: string
): readonly ArchiveEntry[] => {
  const entries: ArchiveEntry[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, {
      withFileTypes: true,
    }).toSorted((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `Release bundles cannot contain links: ${absolutePath}`
        );
      }
      const relativePath = relative(rootDir, absolutePath).replaceAll(
        '\\',
        '/'
      );
      entries.push({
        bytes: readFileSync(absolutePath),
        mode: relativePath === 'bin/trails' ? 0o755 : 0o644,
        path: `${archiveRoot}/${relativePath}`,
      });
    }
  };
  visit(rootDir);
  return entries;
};

const writeText = (
  target: Buffer,
  offset: number,
  length: number,
  value: string
): void => {
  const encoded = Buffer.from(value);
  if (encoded.length > length) {
    throw new Error(`Tar header field is too long: ${value}`);
  }
  encoded.copy(target, offset);
};

const writeOctal = (
  target: Buffer,
  offset: number,
  length: number,
  value: number
): void => {
  const encoded = value.toString(8).padStart(length - 1, '0');
  writeText(target, offset, length - 1, encoded);
};

const splitTarPath = (
  path: string
): { readonly name: string; readonly prefix: string } => {
  if (Buffer.byteLength(path) <= 100) {
    return { name: path, prefix: '' };
  }
  for (
    let index = path.lastIndexOf('/');
    index > 0;
    index = path.lastIndexOf('/', index - 1)
  ) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`Tar path is too long: ${path}`);
};

const tarHeader = (entry: ArchiveEntry): Buffer => {
  const header = Buffer.alloc(512);
  const { name, prefix } = splitTarPath(entry.path);
  writeText(header, 0, 100, name);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.bytes.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeText(header, 257, 6, 'ustar');
  writeText(header, 263, 2, '00');
  writeText(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
};

export const createDeterministicTarGzip = (
  rootDir: string,
  archiveRoot: string
): Uint8Array => {
  const chunks: Buffer[] = [];
  for (const entry of collectArchiveEntries(rootDir, archiveRoot)) {
    chunks.push(tarHeader(entry), entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Bun.gzipSync(Buffer.concat(chunks), { level: 9 });
};

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

const readVersion = (repoRoot: string): string => {
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, 'apps/trails/package.json'), 'utf8')
  ) as { version?: string };
  if (!packageJson.version) {
    throw new Error('apps/trails/package.json does not declare a version');
  }
  return packageJson.version;
};

export const verifyTrailsCliArchive = (
  artifact: Pick<
    TrailsCliReleaseArtifact,
    'archivePath' | 'platform' | 'version'
  >
): void => {
  const host = currentTrailsCliReleasePlatform();
  if (artifact.platform !== host) {
    throw new Error(
      `Cannot cold-start ${artifact.platform} on the ${host} release host`
    );
  }
  const extractRoot = mkdtempSync(join(tmpdir(), 'trails-cli-cold-'));
  try {
    const extract = Bun.spawnSync([
      'tar',
      '-xzf',
      artifact.archivePath,
      '-C',
      extractRoot,
    ]);
    if (extract.exitCode !== 0) {
      throw new Error(textDecoder.decode(extract.stderr));
    }
    const rootName = artifact.archivePath
      .split('/')
      .at(-1)
      ?.replace(/\.tar\.gz$/u, '');
    if (!rootName) {
      throw new Error(`Invalid archive path: ${artifact.archivePath}`);
    }
    const launcher = join(extractRoot, rootName, 'bin/trails');
    const bundleRoot = join(extractRoot, rootName);
    for (const [argument, expected] of [
      ['--version', artifact.version],
      ['--help', 'Usage: trails'],
    ] as const) {
      const result = Bun.spawnSync([launcher, argument], {
        cwd: extractRoot,
        env: {
          HOME: extractRoot,
          PATH: process.env['PATH'] ?? '',
        },
      });
      const output = textDecoder.decode(result.stdout);
      if (result.exitCode !== 0 || !output.includes(expected)) {
        throw new Error(
          `Cold Trails CLI ${argument} check failed: ${textDecoder.decode(result.stderr) || output}`
        );
      }
    }
    const example = Bun.spawnSync(
      [
        launcher,
        'run',
        'example',
        'survey.brief',
        'Brief capability report',
        '--root-dir',
        '.',
        '--module',
        'lib/app.js',
        '--permit',
        '{"id":"release-cold-verifier","scopes":["trails:run"]}',
      ],
      {
        cwd: bundleRoot,
        env: {
          HOME: extractRoot,
          PATH: process.env['PATH'] ?? '',
        },
      }
    );
    const exampleOutput = textDecoder.decode(example.stdout);
    const expectedExampleOutput = 'OK  survey.brief :: Brief capability report';
    if (
      example.exitCode !== 0 ||
      !exampleOutput.split(/\r?\n/u).includes(expectedExampleOutput)
    ) {
      throw new Error(
        `Cold Trails CLI authored example check failed: ${textDecoder.decode(example.stderr) || exampleOutput}`
      );
    }
  } finally {
    rmSync(extractRoot, { force: true, recursive: true });
  }
};

export const buildTrailsCliReleaseArtifact = async (
  options: BuildTrailsCliReleaseOptions
): Promise<TrailsCliReleaseArtifact> => {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const platform = options.platform ?? currentTrailsCliReleasePlatform();
  const host = currentTrailsCliReleasePlatform();
  if (platform !== host) {
    throw new Error(
      `Build ${platform} on its matching host so Bun installs the correct optional bindings; current host is ${host}`
    );
  }
  const descriptor = platformDescriptor(platform);
  const packageVersion = readVersion(repoRoot);
  const version = options.version ?? packageVersion;
  if (version !== packageVersion) {
    throw new Error(
      `Requested version ${version} does not match apps/trails/package.json ${packageVersion}`
    );
  }

  const outputDir = resolve(options.outDir);
  mkdirSync(outputDir, { recursive: true });
  const stagingDir = mkdtempSync(join(tmpdir(), 'trails-cli-release-'));
  const archiveName = trailsCliArchiveName(version, platform);
  const archiveRoot = archiveName.replace(/\.tar\.gz$/u, '');
  const bundleRoot = join(stagingDir, archiveRoot);
  try {
    mkdirSync(join(bundleRoot, 'bin'), { recursive: true });
    mkdirSync(join(bundleRoot, 'lib'), { recursive: true });
    for (const [entrypoint, output, label] of [
      ['apps/trails/bin/trails.ts', 'trails.js', 'CLI'],
      ['apps/trails/src/app.ts', 'app.js', 'app module'],
    ] as const) {
      const build = Bun.spawnSync(
        [
          process.execPath,
          'build',
          entrypoint,
          '--target=bun',
          ...BUNDLE_EXTERNALS.flatMap((external) => ['--external', external]),
          '--outfile',
          join(bundleRoot, 'lib', output),
        ],
        { cwd: repoRoot }
      );
      if (build.exitCode !== 0) {
        throw new Error(
          `Could not bundle the Trails ${label}: ${textDecoder.decode(build.stderr)}`
        );
      }
    }

    const parserRoot = resolvePackageRoot(
      'oxc-parser',
      join(repoRoot, 'packages/source/src')
    );
    const resolverRoot = resolvePackageRoot(
      'oxc-resolver',
      join(repoRoot, 'packages/warden/src')
    );
    const includedPackages = [
      copyPackage('oxc-parser', parserRoot, bundleRoot),
      copyPackage('oxc-resolver', resolverRoot, bundleRoot),
      copyPackage(
        descriptor.oxcParserBinding,
        resolvePackageRoot(descriptor.oxcParserBinding, parserRoot),
        bundleRoot
      ),
      copyPackage(
        descriptor.oxcResolverBinding,
        resolvePackageRoot(descriptor.oxcResolverBinding, resolverRoot),
        bundleRoot
      ),
    ];
    const dependencies: Record<string, string> = {};
    for (const {
      name,
      version: dependencyVersion,
    } of includedPackages.toSorted((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      dependencies[name] = dependencyVersion;
    }
    writeFileSync(
      join(bundleRoot, 'package.json'),
      `${JSON.stringify(
        {
          dependencies,
          name: '@ontrails/trails-homebrew-bundle',
          private: true,
          type: 'module',
          version,
        },
        null,
        2
      )}\n`
    );
    const launcherPath = join(bundleRoot, 'bin/trails');
    writeFileSync(launcherPath, launcherSource);
    chmodSync(launcherPath, 0o755);

    const archiveBytes = createDeterministicTarGzip(bundleRoot, archiveRoot);
    const archivePath = join(outputDir, archiveName);
    const checksum = sha256(archiveBytes);
    const checksumPath = `${archivePath}.sha256`;
    writeFileSync(archivePath, archiveBytes);
    writeFileSync(checksumPath, `${checksum}  ${archiveName}\n`);
    const artifact = {
      archiveName,
      archivePath,
      checksum,
      checksumPath,
      platform,
      version,
    } satisfies TrailsCliReleaseArtifact;
    verifyTrailsCliArchive(artifact);
    return artifact;
  } finally {
    rmSync(stagingDir, { force: true, recursive: true });
  }
};

const parseCliArgs = (
  args: readonly string[]
): BuildTrailsCliReleaseOptions => {
  let outDir: string | undefined;
  let platform: TrailsCliReleasePlatform | undefined;
  let repoRoot: string | undefined;
  let version: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${argument}`);
    }
    if (argument === '--out-dir') {
      outDir = value;
    } else if (argument === '--platform') {
      if (
        !trailsCliReleasePlatformValues.includes(
          value as TrailsCliReleasePlatform
        )
      ) {
        throw new Error(`Unsupported Trails CLI release platform: ${value}`);
      }
      platform = value as TrailsCliReleasePlatform;
    } else if (argument === '--repo-root') {
      repoRoot = value;
    } else if (argument === '--version') {
      version = value;
    } else {
      throw new Error(`Unknown Trails CLI release argument: ${argument}`);
    }
    index += 1;
  }
  if (!outDir) {
    throw new Error('Missing required argument: --out-dir');
  }
  return {
    outDir,
    ...(platform ? { platform } : {}),
    ...(repoRoot ? { repoRoot } : {}),
    ...(version ? { version } : {}),
  };
};

export const runTrailsCliReleaseCli = async (
  args: readonly string[]
): Promise<number> => {
  try {
    const artifact = await buildTrailsCliReleaseArtifact(parseCliArgs(args));
    console.log(
      `Built and cold-verified ${artifact.archiveName} (${artifact.checksum})`
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
