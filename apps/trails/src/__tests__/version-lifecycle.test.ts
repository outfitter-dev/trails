import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { deriveCliCommands } from '@ontrails/cli';
import { isTrailsError, Result, topo, trail } from '@ontrails/core';
import { TOPO_GRAPH_SCHEMA_VERSION } from '@ontrails/topographer';
import type { TopoGraph } from '@ontrails/topographer';
import { z } from 'zod';

import { app } from '../app.js';
import {
  readLifecycleSourceFile,
  writeLifecycleSourceFile,
} from '../lifecycle-source-io.js';
import { deprecateTrail } from '../trails/deprecate.js';
import { doctorTrail } from '../trails/doctor.js';
import { reviseTrail } from '../trails/revise.js';
import { deriveDoctorSummary } from '../trails/version-lifecycle-support.js';

const repoTempDir = (): string =>
  mkdtempSync(join(resolve('.'), '.trails-life-'));

const createDoctorForceGraph = (): TopoGraph => ({
  activationGraph: {
    edgeCount: 0,
    edges: [],
    sourceCount: 0,
    sourceKeys: [],
    trailIds: [],
  },
  activationSources: {},
  entries: [
    {
      exampleCount: 0,
      forces: [
        {
          acceptedAt: '2026-06-01T00:00:00.000Z',
          change: 'modified',
          detail: 'Required input field "name" added',
          id: 'force.current',
          kind: 'trail',
          severity: 'breaking',
          source: 'trails compile --force',
        },
      ],
      id: 'force.current',
      kind: 'trail',
      surfaces: [],
    },
  ],
  forces: [
    {
      acceptedAt: '2026-06-01T00:00:00.000Z',
      change: 'removed',
      detail: 'Trail was removed',
      id: 'force.removed',
      kind: 'trail',
      reason: 'No callers remain.',
      severity: 'breaking',
      source: 'trails compile --force',
    },
  ],
  generatedAt: '2026-06-01T00:00:00.000Z',
  topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
});

const writeLifecycleFixture = (
  dir: string,
  options?: {
    readonly nestedOutputField?: boolean;
    readonly nestedTemplateBlaze?: boolean;
  }
): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  const dollar = String.fromCodePoint(36);
  const inputNameInterpolation = `${dollar}{input.name}`;
  const input = options?.nestedOutputField
    ? `z.object({
    output: z.string(),
    name: z.string(),
  })`
    : 'z.object({ name: z.string() })';
  const blaze = options?.nestedTemplateBlaze
    ? `async (input) => {
    const nested = \`\${\`\${input.name}\`}\`;
    return Result.ok({ message: \`Hello, \${nested}!\` });
  }`
    : `async (input) => Result.ok({ message: \`Hello, ${inputNameInterpolation}!\` })`;
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  blaze: ${blaze},
  input: ${input},
  output: z.object({ message: z.string() }),
});

export const app = topo('life-fixture', { hello });
`
  );
};

const writeLifecycleNumericVersionKeyFixture = (dir: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  blaze: async (input) => Result.ok({ message: \`Hello, \${input.name}!\` }),
  version: 3,
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  versions: {
    1: {
      input: z.object({
        2: z.string().optional(),
        name: z.string(),
      }),
      output: z.object({ message: z.string() }),
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
    },
    2: {
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
    },
  },
});

export const app = topo('life-fixture', { hello });
`
  );
};

const writeLifecycleLastVersionNoTrailingCommaFixture = (dir: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  blaze: async (input) => Result.ok({ message: \`Hello, \${input.name}!\` }),
  version: 2,
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  versions: {
    1: {
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
    }
  },
});

export const app = topo('life-fixture', { hello });
`
  );
};

const writeLifecycleNoResultFixture = (dir: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  blaze: async () => ({ ok: true }) as never,
  version: 2,
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  versions: {
    1: {
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
    },
  },
});

export const app = topo('life-fixture', { hello });
`
  );
};

const writeLifecycleResultImportShapeFixture = (
  dir: string,
  coreImport: string
): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `${coreImport}
import { z } from 'zod';

const hello = trail('hello', {
  blaze: async () => ({ ok: true }) as never,
  version: 2,
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  versions: {
    1: {
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
    },
  },
});

export const app = topo('life-fixture', { hello });
`
  );
};

const lifecycleCommand = (path: string) => {
  const commands = deriveCliCommands(app);
  if (commands.isErr()) {
    throw commands.error;
  }
  const command = commands.value.find(
    (candidate) => candidate.path.join(' ') === path
  );
  if (command === undefined) {
    throw new Error(`Expected lifecycle command: ${path}`);
  }
  return command;
};

describe('trails lifecycle commands', () => {
  test('project the settled lifecycle CLI grammar', () => {
    const revise = lifecycleCommand('revise');
    const deprecate = lifecycleCommand('deprecate');
    const doctor = lifecycleCommand('doctor');

    expect(revise.args.map((arg) => arg.name)).toEqual(['target']);
    expect(revise.flags.map((flag) => flag.name)).toContain('as');
    expect(deprecate.args.map((arg) => arg.name)).toEqual(['target']);
    expect(deprecate.flags.map((flag) => flag.name)).toContain('archive');
    expect(doctor.args).toEqual([]);

    const paths = deriveCliCommands(app);
    if (paths.isErr()) {
      throw paths.error;
    }
    expect(paths.value.map((command) => command.path.join(' '))).not.toEqual(
      expect.arrayContaining(['version', 'sunset', 'mark', 'fork', 'archive'])
    );
  });

  test('revise scaffolds a historical version and deprecate sets status', async () => {
    const dir = repoTempDir();
    try {
      writeLifecycleFixture(dir);

      const revised = await reviseTrail.blaze(
        { module: './src/app.ts', target: 'hello' },
        { cwd: dir } as never
      );

      if (revised.isErr()) {
        throw revised.error;
      }
      expect(revised.value.filePath).toBe(join(dir, 'src', 'app.ts'));
      let source = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      expect(source).toContain('version: 2');
      expect(source).toContain('versions: {');
      expect(source).toContain('1: {');
      expect(source).toContain('transpose: {');

      const deprecated = await deprecateTrail.blaze(
        {
          module: './src/app.ts',
          note: 'Use v2.',
          successor: 2,
          target: 'hello@1',
        },
        { cwd: dir } as never
      );

      if (deprecated.isErr()) {
        throw deprecated.error;
      }
      expect(deprecated.value.filePath).toBe(join(dir, 'src', 'app.ts'));
      source = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      expect(source).toContain(
        '      status: { state: \'deprecated\', successor: 2, note: "Use v2." }'
      );
      expect(source).not.toMatch(/^status:/m);

      const alreadyDeprecated = await deprecateTrail.blaze(
        {
          module: './src/app.ts',
          note: 'Use v2.',
          successor: 2,
          target: 'hello@1',
        },
        { cwd: dir } as never
      );

      if (alreadyDeprecated.isErr()) {
        throw alreadyDeprecated.error;
      }
      expect(alreadyDeprecated.value.updated).toBe(false);

      const forked = await reviseTrail.blaze(
        { as: 'fork', module: './src/app.ts', target: 'hello@1' },
        { cwd: dir } as never
      );

      if (forked.isErr()) {
        throw forked.error;
      }
      expect(forked.value.updated).toBe(true);
      source = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      expect(source).toContain('      blaze: async () => Result.err');
      expect(source).not.toMatch(/^blaze:/m);
      expect(source).not.toContain('transpose: {');

      const alreadyForked = await reviseTrail.blaze(
        { as: 'fork', module: './src/app.ts', target: 'hello@1' },
        { cwd: dir } as never
      );

      if (alreadyForked.isErr()) {
        throw alreadyForked.error;
      }
      expect(alreadyForked.value.updated).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('revise preserves blaze values with nested template literals', async () => {
    const dir = repoTempDir();
    try {
      writeLifecycleFixture(dir, { nestedTemplateBlaze: true });

      const revised = await reviseTrail.blaze(
        { as: 'fork', module: './src/app.ts', target: 'hello' },
        { cwd: dir } as never
      );

      if (revised.isErr()) {
        throw revised.error;
      }
      const source = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      const dollar = String.fromCodePoint(36);
      const nestedTemplateSnippet = `const nested = \`${dollar}{\`${dollar}{input.name}\`}\`;`;
      expect(source).toContain(nestedTemplateSnippet);
      expect(source).toContain('version: 2');
      expect(source).toContain('1: {');
      expect(source).toContain('blaze: async (input) => {');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('revise reads top-level config keys when schemas reuse key names', async () => {
    const dir = repoTempDir();
    try {
      writeLifecycleFixture(dir, { nestedOutputField: true });

      const revised = await reviseTrail.blaze(
        { module: './src/app.ts', target: 'hello' },
        { cwd: dir } as never
      );

      if (revised.isErr()) {
        throw revised.error;
      }
      const source = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      expect(source).toContain('version: 2');
      expect(source).toContain('input: z.object({');
      expect(source).toContain('output: z.string()');
      expect(source).toContain(
        '      output: z.object({ message: z.string() }),'
      );
      expect(source).not.toContain('      output: z.string(),');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('deprecate reads top-level version entries when schemas reuse numeric keys', async () => {
    const dir = repoTempDir();
    try {
      writeLifecycleNumericVersionKeyFixture(dir);

      const deprecated = await deprecateTrail.blaze(
        {
          module: './src/app.ts',
          note: 'Use v3.',
          successor: 3,
          target: 'hello@2',
        },
        { cwd: dir } as never
      );

      if (deprecated.isErr()) {
        throw deprecated.error;
      }
      const source = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      expect(source).toContain('        2: z.string().optional(),');
      expect(source).toContain(`    2: {
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
      status: { state: 'deprecated', successor: 3, note: "Use v3." },
    },`);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('deprecate preserves comma-free last version entry boundaries', async () => {
    const dir = repoTempDir();
    try {
      writeLifecycleLastVersionNoTrailingCommaFixture(dir);

      const deprecated = await deprecateTrail.blaze(
        {
          module: './src/app.ts',
          note: 'Use v2.',
          successor: 2,
          target: 'hello@1',
        },
        { cwd: dir } as never
      );

      if (deprecated.isErr()) {
        throw deprecated.error;
      }
      const source = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      expect(source)
        .toContain(`      status: { state: 'deprecated', successor: 2, note: "Use v2." },
    }
  },`);
      expect(source).not.toContain(`  }
      status:`);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('fork warns when the placeholder needs an unimported Result binding', async () => {
    const dir = repoTempDir();
    try {
      writeLifecycleNoResultFixture(dir);

      const forked = await reviseTrail.blaze(
        { as: 'fork', module: './src/app.ts', target: 'hello@1' },
        { cwd: dir } as never
      );

      if (forked.isErr()) {
        throw forked.error;
      }
      expect(forked.value.updated).toBe(true);
      expect(forked.value.warnings).toEqual([
        'Fork blaze placeholder references Result.err, but this file does not import Result from @ontrails/core.',
      ]);
      const source = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      expect(source).toContain('      blaze: async () => Result.err');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('fork warns when Result is type-only or aliased', async () => {
    const cases = [
      {
        coreImport: `import type { Result } from '@ontrails/core';
import { topo, trail } from '@ontrails/core';`,
        name: 'type-only Result import',
      },
      {
        coreImport:
          "import { Result as R, topo, trail } from '@ontrails/core';",
        name: 'aliased Result import',
      },
    ];

    for (const fixture of cases) {
      const dir = repoTempDir();
      try {
        writeLifecycleResultImportShapeFixture(dir, fixture.coreImport);

        const forked = await reviseTrail.blaze(
          { as: 'fork', module: './src/app.ts', target: 'hello@1' },
          { cwd: dir } as never
        );

        if (forked.isErr()) {
          throw new Error(`${fixture.name}: ${forked.error.message}`);
        }
        expect(forked.value.warnings).toEqual([
          'Fork blaze placeholder references Result.err, but this file does not import Result from @ontrails/core.',
        ]);
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  test('source write failures return Result errors', () => {
    const dir = repoTempDir();
    try {
      const result = writeLifecycleSourceFile(
        join(dir, 'missing', 'app.ts'),
        ''
      );

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(Error);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('source read failures return Result errors', () => {
    const dir = repoTempDir();
    try {
      const result = readLifecycleSourceFile(join(dir, 'missing', 'app.ts'));

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(Error);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('doctor reports version lifecycle counts', async () => {
    const dir = repoTempDir();
    try {
      writeLifecycleFixture(dir);
      await reviseTrail.blaze({ module: './src/app.ts', target: 'hello' }, {
        cwd: dir,
      } as never);
      await deprecateTrail.blaze(
        { archive: true, module: './src/app.ts', target: 'hello@1' },
        { cwd: dir } as never
      );

      const doctor = await doctorTrail.blaze({ module: './src/app.ts' }, {
        cwd: dir,
      } as never);

      if (doctor.isErr()) {
        throw doctor.error;
      }
      expect(doctor.value).toMatchObject({
        archived: 1,
        mode: 'doctor',
        trails: 1,
        versioned: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('doctor reports lifecycle counts when topo lock is unreadable', async () => {
    const dir = repoTempDir();
    try {
      writeLifecycleFixture(dir);
      await reviseTrail.blaze({ module: './src/app.ts', target: 'hello' }, {
        cwd: dir,
      } as never);
      await deprecateTrail.blaze(
        { archive: true, module: './src/app.ts', target: 'hello@1' },
        { cwd: dir } as never
      );
      mkdirSync(join(dir, '.trails'), { recursive: true });
      writeFileSync(join(dir, '.trails', 'topo.lock'), '{');

      const doctor = await doctorTrail.blaze({ module: './src/app.ts' }, {
        cwd: dir,
      } as never);

      if (doctor.isErr()) {
        throw doctor.error;
      }
      expect(doctor.value).toMatchObject({
        archived: 1,
        forceDetails: [],
        forceEvents: 0,
        mode: 'doctor',
        trails: 1,
        versioned: 1,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('doctor returns the validation error for an invalid topo', async () => {
    const dir = repoTempDir();
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src', 'app.ts'),
        `import { Result, resource, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const store = resource<{ ping: () => string }>('orphan-store', {
  create: () => Result.ok({ ping: () => 'pong' }),
  mock: () => ({ ping: () => 'pong' }),
});

const ping = trail('ping', {
  blaze: (_input, ctx) => Result.ok({ message: store.from(ctx).ping() }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ message: z.string() }),
  resources: [store],
});

// The store module is deliberately omitted from topo() so validation fails.
export const app = topo('doctor-invalid', { ping });
`
      );

      const doctor = await doctorTrail.blaze({ module: './src/app.ts' }, {
        cwd: dir,
      } as never);

      expect(doctor.isErr()).toBe(true);
      if (doctor.isOk()) {
        throw new Error('expected doctor to fail on an invalid topo');
      }
      expect(isTrailsError(doctor.error)).toBe(true);
      expect(
        isTrailsError(doctor.error) ? doctor.error.category : 'unknown'
      ).toBe('validation');
      expect(doctor.error.message).toContain('Topo validation failed');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('doctor returns an internal error for unexpected summary failures', async () => {
    const dir = repoTempDir();
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src', 'app.ts'),
        `export const app = {
  name: 'doctor-broken',
  trails: { broken: true },
  contours: new Map(),
  signals: new Map(),
  resources: new Map(),
  layers: [],
};
`
      );

      const doctor = await doctorTrail.blaze({ module: './src/app.ts' }, {
        cwd: dir,
      } as never);

      expect(doctor.isErr()).toBe(true);
      if (doctor.isOk()) {
        throw new Error('expected doctor to fail on a malformed topo');
      }
      expect(isTrailsError(doctor.error)).toBe(true);
      expect(
        isTrailsError(doctor.error) ? doctor.error.category : 'unknown'
      ).toBe('internal');
      expect(doctor.error.message).toContain('Unable to derive doctor summary');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('doctor reads committed force audit details', async () => {
    const dir = repoTempDir();
    try {
      writeLifecycleFixture(dir);
      mkdirSync(join(dir, '.trails'), { recursive: true });
      writeFileSync(
        join(dir, '.trails', 'topo.lock'),
        JSON.stringify(createDoctorForceGraph())
      );

      const doctor = await doctorTrail.blaze({ module: './src/app.ts' }, {
        cwd: dir,
      } as never);

      if (doctor.isErr()) {
        throw doctor.error;
      }
      expect(doctor.value.forceEvents).toBe(2);
      expect(
        doctor.value.forceDetails.map(({ id, scope }) => ({ id, scope }))
      ).toEqual([
        { id: 'force.current', scope: 'entry' },
        { id: 'force.removed', scope: 'graph' },
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('doctor summary reports entry and graph force details', () => {
    const current = trail('force.current', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });

    const summary = deriveDoctorSummary(topo('doctor-force', { current }), {
      forceGraph: createDoctorForceGraph(),
    });

    expect(summary.forceEvents).toBe(2);
    expect(summary.forceDetails).toEqual([
      {
        acceptedAt: '2026-06-01T00:00:00.000Z',
        change: 'modified',
        detail: 'Required input field "name" added',
        id: 'force.current',
        kind: 'trail',
        scope: 'entry',
        severity: 'breaking',
        source: 'trails compile --force',
      },
      {
        acceptedAt: '2026-06-01T00:00:00.000Z',
        change: 'removed',
        detail: 'Trail was removed',
        id: 'force.removed',
        kind: 'trail',
        reason: 'No callers remain.',
        scope: 'graph',
        severity: 'breaking',
        source: 'trails compile --force',
      },
    ]);
  });

  test('doctor summary deduplicates overlapping entry and graph force details', () => {
    const current = trail('force.current', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const graph = createDoctorForceGraph();
    const duplicate = graph.entries[0]?.forces?.[0];
    if (duplicate === undefined) {
      throw new Error('Expected force fixture to include an entry force');
    }

    const summary = deriveDoctorSummary(topo('doctor-force', { current }), {
      forceGraph: {
        ...graph,
        forces: [duplicate, ...(graph.forces ?? [])],
      },
    });

    expect(summary.forceEvents).toBe(2);
    expect(
      summary.forceDetails.map(({ id, scope }) => ({ id, scope }))
    ).toEqual([
      { id: 'force.current', scope: 'entry' },
      { id: 'force.removed', scope: 'graph' },
    ]);
  });

  test('doctor summary ignores malformed stale force payloads', () => {
    const current = trail('force.current', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const graph = createDoctorForceGraph();
    const [entry] = graph.entries;
    const validEntryForce = entry?.forces?.[0];
    if (entry === undefined || validEntryForce === undefined) {
      throw new Error('Expected force fixture to include an entry force');
    }

    const summary = deriveDoctorSummary(topo('doctor-force', { current }), {
      forceGraph: {
        ...graph,
        entries: [
          {
            ...entry,
            forces: { stale: true } as never,
          },
          {
            ...entry,
            forces: [null, { ...validEntryForce, extra: 'ignored' }] as never,
          },
        ],
        forces: [
          undefined,
          { ...(graph.forces?.[0] ?? validEntryForce), reason: 123 },
          ...(graph.forces ?? []),
        ] as never,
      },
    });

    expect(summary.forceEvents).toBe(2);
    expect(summary.forceDetails[0]).not.toHaveProperty('extra');
    expect(
      summary.forceDetails.map(({ id, scope }) => ({ id, scope }))
    ).toEqual([
      { id: 'force.current', scope: 'entry' },
      { id: 'force.removed', scope: 'graph' },
    ]);
  });
});
