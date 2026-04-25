import { scaffoldDependencyVersions } from './scaffold-versions.generated.js';

interface PackageJson {
  readonly version?: string;
}

const readPackageJson = async (url: URL): Promise<PackageJson> =>
  (await Bun.file(url).json()) as PackageJson;

const appPackageJson = await readPackageJson(
  new URL('../package.json', import.meta.url)
);

const requireVersion = (value: string | undefined, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing version for ${label}`);
  }
  return value;
};

export const trailsPackageVersion = requireVersion(
  appPackageJson.version,
  '@ontrails/trails'
);

export const ontrailsPackageRange = `^${trailsPackageVersion}`;

export { scaffoldDependencyVersions };
