/**
 * One-time release facts for moving the unpublished 1.0.0 source state onto
 * the first normal 0.x line. Exact predicates keep ordinary downgrade guards
 * intact and become inert after 0.2.0.
 */
export const INITIAL_ZERO_LINE_VERSION = '0.2.0';

const INITIAL_ZERO_LINE_PACKAGES = new Set([
  '@ontrails/adapter-kit',
  '@ontrails/cli',
  '@ontrails/cloudflare',
  '@ontrails/commander',
  '@ontrails/config',
  '@ontrails/core',
  '@ontrails/drizzle',
  '@ontrails/hono',
  '@ontrails/http',
  '@ontrails/library',
  '@ontrails/logtape',
  '@ontrails/mcp',
  '@ontrails/observability',
  '@ontrails/permits',
  '@ontrails/pino',
  '@ontrails/regrade',
  '@ontrails/source',
  '@ontrails/store',
  '@ontrails/testing',
  '@ontrails/topography',
  '@ontrails/trails',
  '@ontrails/vite',
  '@ontrails/warden',
]);

export const isCompleteInitialZeroLinePackageSet = (
  names: readonly string[]
): boolean =>
  names.length === INITIAL_ZERO_LINE_PACKAGES.size &&
  new Set(names).size === INITIAL_ZERO_LINE_PACKAGES.size &&
  names.every((name) => INITIAL_ZERO_LINE_PACKAGES.has(name));

const BETA_LINE_VERSION = /^1\.0\.0-beta\.(?:0|[1-9]\d*)$/u;

export const isInitialZeroLineSourceTransition = (
  previousVersion: string,
  nextVersion: string,
  name: string | undefined
): boolean =>
  previousVersion === '1.0.0' &&
  nextVersion === INITIAL_ZERO_LINE_VERSION &&
  name !== undefined &&
  INITIAL_ZERO_LINE_PACKAGES.has(name);

export const isInitialZeroLineRegistryTransition = ({
  currentTagVersion,
  expectedTag,
  name,
  targetVersion,
}: {
  readonly currentTagVersion: string;
  readonly expectedTag: string | undefined;
  readonly name: string | undefined;
  readonly targetVersion: string;
}): boolean =>
  expectedTag === 'latest' &&
  targetVersion === INITIAL_ZERO_LINE_VERSION &&
  name !== undefined &&
  INITIAL_ZERO_LINE_PACKAGES.has(name) &&
  BETA_LINE_VERSION.test(currentTagVersion);
