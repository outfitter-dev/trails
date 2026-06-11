const packageKeyOrder = [
  'name',
  'version',
  'bin',
  'type',
  'scripts',
  'dependencies',
  'devDependencies',
] as const;

const packageMapKeys = new Set<string>([
  'bin',
  'dependencies',
  'devDependencies',
  'scripts',
]);

export type ScaffoldPackageJson = Record<string, unknown>;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sortRecord = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).toSorted(([left], [right]) =>
      left.localeCompare(right)
    )
  );

const normalizePackageValue = (key: string, value: unknown): unknown =>
  packageMapKeys.has(key) && isPlainRecord(value) ? sortRecord(value) : value;

export const normalizeScaffoldPackageJson = (
  pkg: ScaffoldPackageJson
): ScaffoldPackageJson => {
  const normalized: ScaffoldPackageJson = {};

  for (const key of packageKeyOrder) {
    if (pkg[key] !== undefined) {
      normalized[key] = normalizePackageValue(key, pkg[key]);
    }
  }

  for (const key of Object.keys(pkg).toSorted()) {
    if (!(key in normalized)) {
      normalized[key] = normalizePackageValue(key, pkg[key]);
    }
  }

  return normalized;
};

export const stringifyScaffoldJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

export const stringifyScaffoldPackageJson = (
  pkg: ScaffoldPackageJson
): string => stringifyScaffoldJson(normalizeScaffoldPackageJson(pkg));
