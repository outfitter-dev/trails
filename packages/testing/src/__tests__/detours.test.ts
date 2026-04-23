import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ConflictError, Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { testDetours } from '../detours.js';

const showTrail = trail('entity.show', {
  blaze: (input: { id: string }) => Result.ok({ id: input.id }),
  detours: [
    {
      on: ConflictError,
      /* oxlint-disable-next-line require-await -- test stub */
      recover: async () => Result.ok({ id: 'recovered' }),
    },
  ],
  input: z.object({ id: z.string() }),
});

const noDetoursTrail = trail('entity.plain', {
  blaze: () => Result.ok('ok'),
  input: z.object({}),
});

const createBlankNamedDetourTrail = () => {
  class BlankNamedConflictError extends ConflictError {}

  Object.defineProperty(BlankNamedConflictError, 'name', { value: '' });

  return trail('entity.blank-name', {
    blaze: (input: { id: string }) => Result.ok({ id: input.id }),
    detours: [
      {
        on: BlankNamedConflictError,
        /* oxlint-disable-next-line require-await -- test stub */
        recover: async () => Result.ok({ id: 'recovered' }),
      },
    ],
    input: z.object({ id: z.string() }),
  });
};

const repoTempDir = (): string =>
  join(
    resolve(import.meta.dir, '../..'),
    '.tmp-tests',
    `test-detours-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

const generatedSuiteSource = (
  variant: 'invalidOn' | 'invalidRecover' | 'shadowed'
): string => {
  const shared = `import { ConflictError, Result, TrailsError, trail, topo } from '@ontrails/core';
import { testDetours } from '../../src/index.ts';
import { z } from 'zod';

const baseTrail = trail('entity.save', {
  blaze: () => Result.err(new ConflictError('conflict')),
  detours: [
    {
      on: ConflictError,
      recover: async () => Result.ok({ recovered: true }),
    },
  ],
  input: z.object({}),
  output: z.object({ recovered: z.boolean() }),
});
`;

  if (variant === 'invalidOn') {
    return `${shared}
const candidate = {
  ...baseTrail,
  detours: [
    {
      on: 'ConflictError',
      recover: async () => Result.ok({ recovered: true }),
    },
  ],
} as typeof baseTrail;

testDetours(topo('detour-invalid-on', { candidate } as Record<string, unknown>));
`;
  }

  if (variant === 'invalidRecover') {
    return `${shared}
const candidate = {
  ...baseTrail,
  detours: [
    {
      on: ConflictError,
      recover: 'not callable',
    },
  ],
} as typeof baseTrail;

testDetours(topo('detour-invalid-recover', { candidate } as Record<string, unknown>));
`;
  }

  return `${shared}
const candidate = trail('entity.shadowed', {
  blaze: () => Result.err(new ConflictError('conflict')),
  detours: [
    {
      on: TrailsError,
      recover: async () => Result.ok({ recovered: 'broad' }),
    },
    {
      on: ConflictError,
      recover: async () => Result.ok({ recovered: 'specific' }),
    },
  ],
  input: z.object({}),
  output: z.object({ recovered: z.string() }),
});

testDetours(topo('detour-shadowed', { candidate }));
`;
};

const runGeneratedDetourSuite = (
  variant: 'invalidOn' | 'invalidRecover' | 'shadowed'
): { readonly exitCode: number; readonly output: string } => {
  const dir = repoTempDir();
  const testFile = join(dir, `${variant}.test.ts`);

  mkdirSync(dir, { recursive: true });
  writeFileSync(testFile, generatedSuiteSource(variant));

  try {
    const proc = Bun.spawnSync({
      cmd: ['bun', 'test', testFile, '--bail'],
      cwd: resolve(import.meta.dir, '..', '..', '..'),
      stderr: 'pipe',
      stdout: 'pipe',
    });

    return {
      exitCode: proc.exitCode,
      output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

describe('testDetours valid contracts', () => {
  // eslint-disable-next-line jest/require-hook
  testDetours(
    topo('test-app', {
      showTrail,
    } as Record<string, unknown>)
  );
});

describe('testDetours skips trails without detours', () => {
  // eslint-disable-next-line jest/require-hook
  testDetours(
    topo('test-app', {
      noDetoursTrail,
    } as Record<string, unknown>)
  );

  test('no-op marker', () => {
    // Trail without detours is skipped -- no detour tests generated
  });
});

describe('testDetours constructor handling', () => {
  // eslint-disable-next-line jest/require-hook
  testDetours(
    topo('test-app', {
      blankNamedDetourTrail: createBlankNamedDetourTrail(),
    } as Record<string, unknown>)
  );
});

describe('testDetours invalid contract detection', () => {
  test('fails when on is not an error constructor', () => {
    const result = runGeneratedDetourSuite('invalidOn');

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(
      'entity.save detour[0] must declare a real error constructor in on:'
    );
  });

  test('fails when recover is not callable', () => {
    const result = runGeneratedDetourSuite('invalidRecover');

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(
      'entity.save detour[0] on ConflictError must declare a callable recover function'
    );
  });

  test('fails when a later detour is shadowed by an earlier broader detour', () => {
    const result = runGeneratedDetourSuite('shadowed');

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(
      'entity.shadowed detour[1] on ConflictError'
    );
    expect(result.output).toContain(
      'shadowed by earlier detour[0] on TrailsError'
    );
  });
});
