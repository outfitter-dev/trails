import {
  accessSync,
  constants,
  mkdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const scratchRoot = join(repoRoot, '.tmp');
const tempRoot = join(scratchRoot, `trails-input-type-cost-${process.pid}`);

const TRAIL_COUNT = Number(
  process.env['TRAIL_INPUT_TYPE_COST_TRAIL_COUNT'] ?? 72
);
const INCLUDE_COMMANDER_SURFACE =
  process.env['TRAIL_INPUT_TYPE_COST_COMMANDER'] !== '0';
const MAX_RSS_BYTES = Number(
  process.env['TRAIL_INPUT_TYPE_COST_MAX_RSS_BYTES'] ?? 900_000_000
);

const executablePath = (command: string): string | undefined => {
  const candidates = command.includes('/')
    ? [command]
    : (process.env['PATH'] ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, command));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning PATH candidates.
    }
  }

  return undefined;
};

const requireTimeExecutable = (
  candidates: readonly string[],
  installHint: string
): string => {
  for (const candidate of candidates) {
    const executable = executablePath(candidate);
    if (executable) {
      return executable;
    }
  }

  throw new Error(installHint);
};

const timeInvocation = (): readonly string[] => {
  if (process.platform === 'darwin') {
    return [
      requireTimeExecutable(
        ['/usr/bin/time', 'time'],
        'trail input type-cost guard requires BSD time on macOS'
      ),
      '-l',
    ];
  }
  if (process.platform === 'linux') {
    return [
      requireTimeExecutable(
        ['/usr/bin/time', '/bin/time', 'time'],
        'trail input type-cost guard requires GNU time on Linux; install the time package or put time on PATH'
      ),
      '-v',
    ];
  }

  throw new Error(
    `trail input type-cost guard does not support process.platform "${process.platform}"`
  );
};

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const pathMap = {
  '@ontrails/*': ['packages/*/src/index.ts', 'adapters/*/src/index.ts'],
  '@ontrails/commander': ['adapters/commander/src/index.ts'],
  '@ontrails/core': ['packages/core/src/index.ts'],
} as const;

const schemaFields = [
  'workspace',
  'project',
  'area',
  'kind',
  'query',
  'owner',
  'status',
  'since',
  'until',
  'tag',
] as const;

const generateTrail = (index: number): string => {
  const fieldLines = schemaFields
    .map(
      (field) =>
        `${field}: z.string().min(1).describe('${field} ${index}').default('${field}-${index}'),`
    )
    .join('\n      ');

  return `
const input${index} = z.object({
      ${fieldLines}
      includeArchived: z.boolean().default(false),
      limit: z.number().int().positive().max(100).default(20),
      offset: z.number().int().nonnegative().default(0),
    });

const trail${index} = trail('almanac.typeCost.${index}', {
  input: input${index},
  output: z.object({
    id: z.string(),
    limit: z.number(),
    workspace: z.string(),
  }),
  examples: [
    {
      name: 'caller omits schema defaults',
      input: { query: 'find-${index}' },
      expected: {
        id: 'find-${index}',
        limit: 20,
        workspace: 'workspace-${index}',
      },
    },
  ],
  blaze: (input) =>
    Result.ok({
      id: input.query,
      limit: input.limit,
      workspace: input.workspace,
    }),
});
`;
};

const source = `
import { Result, topo, trail } from '@ontrails/core';
${INCLUDE_COMMANDER_SURFACE ? "import { surface } from '@ontrails/commander';" : ''}
import { z } from 'zod';

${Array.from({ length: TRAIL_COUNT }, (_, index) => generateTrail(index)).join('\n')}

const app = topo('almanac-type-cost-consumer', {
  ${Array.from({ length: TRAIL_COUNT }, (_, index) => `trail${index}`).join(',\n  ')},
});

${INCLUDE_COMMANDER_SURFACE ? "void surface(app, { name: 'almanac-type-cost' });" : 'void app;'}
`;

const parseMaxRssBytes = (output: string): number | undefined => {
  const darwinMatch = output.match(/^\s*(\d+)\s+maximum resident set size/m);
  if (darwinMatch) {
    return Number(darwinMatch[1]);
  }

  const linuxMatch = output.match(
    /Maximum resident set size \(kbytes\):\s*(\d+)/m
  );
  return linuxMatch ? Number(linuxMatch[1]) * 1024 : undefined;
};

const ignoreEmptyScratchCleanupError = (error: unknown): void => {
  const { code } = error as { code?: unknown };
  if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST') {
    return;
  }

  throw error;
};

const main = () => {
  mkdirSync(tempRoot, { recursive: true });
  const sourcePath = join(tempRoot, 'consumer.ts');
  const tsconfigPath = join(tempRoot, 'tsconfig.json');
  writeFileSync(sourcePath, source);
  writeJson(tsconfigPath, {
    compilerOptions: {
      baseUrl: repoRoot,
      noEmit: true,
      paths: pathMap,
      rootDir: repoRoot,
      types: ['bun'],
    },
    extends: join(repoRoot, 'tsconfig.json'),
    include: [sourcePath],
  });

  try {
    const timeCommand = timeInvocation();
    const proc = Bun.spawnSync({
      cmd: [
        ...timeCommand,
        process.execPath,
        join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        tsconfigPath,
      ],
      cwd: repoRoot,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 120_000,
    });

    const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
    const rssBytes = parseMaxRssBytes(output);
    const failures: string[] = [];

    if (proc.exitedDueToTimeout) {
      failures.push('TypeScript timed out after 120000ms');
    }
    if (proc.exitCode !== 0) {
      failures.push(`TypeScript exited with code ${proc.exitCode}`);
    }
    if (rssBytes === undefined) {
      failures.push(
        `could not parse maximum resident set size from ${timeCommand.join(' ')}`
      );
    } else if (rssBytes > MAX_RSS_BYTES) {
      failures.push(
        `TypeScript RSS ${rssBytes} bytes exceeded ceiling ${MAX_RSS_BYTES} bytes`
      );
    }

    if (failures.length > 0) {
      console.error(failures.join('\n'));
      console.error(output);
      process.exitCode = 1;
      return;
    }

    console.log(
      `trail input type-cost guard passed: ${TRAIL_COUNT} consumer trails, max RSS ${rssBytes} bytes (ceiling ${MAX_RSS_BYTES} bytes)`
    );
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
    try {
      rmdirSync(scratchRoot);
    } catch (error) {
      ignoreEmptyScratchCleanupError(error);
    }
  }
};

main();
