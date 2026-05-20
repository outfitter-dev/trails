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

import { app } from '../app.js';
import {
  readLifecycleSourceFile,
  writeLifecycleSourceFile,
} from '../lifecycle-source-io.js';
import { deprecateTrail } from '../trails/deprecate.js';
import { doctorTrail } from '../trails/doctor.js';
import { reviseTrail } from '../trails/revise.js';

const repoTempDir = (): string =>
  mkdtempSync(join(resolve('.'), '.trails-life-'));

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
});
