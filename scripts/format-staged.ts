const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const JSON_EXTENSIONS = new Set(['.json', '.jsonc']);

export interface FormatTargets {
  readonly code: readonly string[];
  readonly json: readonly string[];
}

const extensionOf = (path: string): string => {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
};

export const partitionFormatTargets = (
  paths: readonly string[]
): FormatTargets => {
  const code: string[] = [];
  const json: string[] = [];

  for (const path of paths) {
    const extension = extensionOf(path);
    if (CODE_EXTENSIONS.has(extension)) {
      code.push(path);
      continue;
    }
    if (JSON_EXTENSIONS.has(extension)) {
      json.push(path);
    }
  }

  return { code, json };
};

const run = async (cmd: readonly string[]): Promise<number> => {
  const proc = Bun.spawn(cmd, {
    stderr: 'inherit',
    stdout: 'inherit',
  });
  return await proc.exited;
};

export const formatStaged = async (
  paths: readonly string[]
): Promise<number> => {
  const targets = partitionFormatTargets(paths);

  if (targets.code.length > 0) {
    const code = await run(['bunx', 'ultracite', 'fix', ...targets.code]);
    if (code !== 0) {
      return code;
    }
  }

  if (targets.json.length > 0) {
    const code = await run([
      'bunx',
      'oxfmt',
      '--write',
      '--no-error-on-unmatched-pattern',
      ...targets.json,
    ]);
    if (code !== 0) {
      return code;
    }
  }

  return 0;
};

if (import.meta.main) {
  const code = await formatStaged(process.argv.slice(2));
  process.exit(code);
}
