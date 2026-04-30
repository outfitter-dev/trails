import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { formatWardenReport, runWarden } from '../cli.js';

const isDraftFileMarking = (rule: string): boolean =>
  rule === 'draft-file-marking';

const isDraftFileMarkingError = (diagnostic: {
  rule: string;
  severity?: string;
}): boolean =>
  isDraftFileMarking(diagnostic.rule) && diagnostic.severity === 'error';

const isDraftFileMarkingWarn = (diagnostic: {
  rule: string;
  severity?: string;
}): boolean =>
  isDraftFileMarking(diagnostic.rule) && diagnostic.severity === 'warn';

const isDraftVisibleDebt = (rule: string): boolean =>
  rule === 'draft-visible-debt';

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `warden-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('runWarden basics', () => {
  test('produces a report with diagnostics for bad code', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("entity.show", {
  blaze: async (input, ctx) => {
    throw new Error("boom");
  }
})`
      );

      const report = await runWarden({ rootDir: dir });
      expect(report.errorCount).toBeGreaterThan(0);
      expect(report.passed).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('passes for clean code', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'good.ts'),
        `trail("entity.show", {
  blaze: async (input, ctx) => {
    return Result.ok(data);
  }
})`
      );

      const report = await runWarden({ rootDir: dir });
      expect(report.errorCount).toBe(0);
      expect(report.passed).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('lintOnly skips drift check', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(join(dir, 'empty.ts'), 'export {}');
      const report = await runWarden({ lintOnly: true, rootDir: dir });
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('driftOnly skips lint', async () => {
    const dir = makeTempDir();
    try {
      // Even with bad code, driftOnly should produce 0 diagnostics
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail("x", { blaze: async () => { throw new Error("x"); } })`
      );
      const report = await runWarden({ driftOnly: true, rootDir: dir });
      expect(report.diagnostics.length).toBe(0);
      expect(report.drift).not.toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('source-static tier runs source rules and skips project rules plus drift', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'mixed.ts'),
        `trail('entity.show', {
  on: ['entity.changed'],
  blaze: async () => {
    throw new Error('boom');
  },
});`
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'source-static',
      });
      const rules = new Set(report.diagnostics.map((d) => d.rule));

      expect(rules.has('no-throw-in-implementation')).toBe(true);
      expect(rules.has('on-references-exist')).toBe(false);
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('project-static tier runs project rules and skips source rules plus drift', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'mixed.ts'),
        `trail('entity.show', {
  on: ['entity.changed'],
  blaze: async () => {
    throw new Error('boom');
  },
});`
      );

      const report = await runWarden({
        rootDir: dir,
        tier: 'project-static',
      });
      const rules = new Set(report.diagnostics.map((d) => d.rule));

      expect(rules.has('no-throw-in-implementation')).toBe(false);
      expect(rules.has('on-references-exist')).toBe(true);
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('drift tier skips lint and runs drift', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'bad.ts'),
        `trail('x', { blaze: async () => { throw new Error('x'); } })`
      );

      const report = await runWarden({ rootDir: dir, tier: 'drift' });

      expect(report.diagnostics).toHaveLength(0);
      expect(report.drift).not.toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('runWarden project context', () => {
  test('reports throw inside detour recover functions', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'recover.ts'),
        `trail("entity.show", {
  detours: [
    {
      on: ConflictError,
      recover: async () => {
        throw new Error("boom");
      },
    },
  ],
  blaze: () => Result.err(new ConflictError("conflict")),
})`
      );

      const report = await runWarden({ rootDir: dir });
      const detourRecoverErrors = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'no-throw-in-detour-recover'
      );

      expect(detourRecoverErrors).toHaveLength(1);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reports detours shadowed by earlier broader on: types', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'shadowed.ts'),
        `import { ConflictError, Result, TrailsError, trail } from '@ontrails/core';

trail("entity.save", {
  detours: [
    { on: TrailsError, recover: async () => Result.ok({ winner: "broad" }) },
    { on: ConflictError, recover: async () => Result.ok({ winner: "specific" }) },
  ],
  blaze: () => Result.err(new ConflictError("boom")),
});`
      );

      const report = await runWarden({ rootDir: dir });
      const shadowRules = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'unreachable-detour-shadowing'
      );

      expect(shadowRules).toHaveLength(1);
      expect(shadowRules[0]?.message).toContain('TrailsError');
      expect(shadowRules[0]?.message).toContain('ConflictError');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('includes topo-aware detour contract diagnostics when topo is supplied', async () => {
    const validTrail = trail('entity.save', {
      blaze: () => Result.ok({ ok: true }),
      detours: [
        {
          on: ConflictError,
          recover: () => Result.ok({ ok: true }),
        },
      ],
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });

    const malformed = {
      ...validTrail,
      detours: [
        {
          on: 'ConflictError',
          recover: 'not callable',
        },
      ],
    } as typeof validTrail;

    const report = await runWarden({
      topo: topo('invalid-detour-contract', {
        malformed,
      } as Record<string, unknown>),
    });

    const contractDiagnostics = report.diagnostics.filter(
      (diagnostic) => diagnostic.rule === 'valid-detour-contract'
    );

    expect(contractDiagnostics).toHaveLength(2);
  });

  test('uses project context for contour references across files', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'user.ts'),
        `import { contour } from '@ontrails/core';
import { z } from 'zod';

export const user = contour('user', {
  id: z.string().uuid(),
}, { identity: 'id' });`
      );
      writeFileSync(
        join(dir, 'gist.ts'),
        `import { contour } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

export const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });`
      );

      const report = await runWarden({ rootDir: dir });
      const referenceErrors = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'reference-exists'
      );

      expect(referenceErrors).toHaveLength(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('preserves empty topo resource sets instead of falling back to file-local ids', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'entity.ts'),
        `import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});

trail('entity.show', {
  resources: [db],
  blaze: async (_input, ctx) => Result.ok(db.from(ctx)),
});`
      );

      const report = await runWarden({ rootDir: dir, topo: topo('empty-app') });
      const resourceErrors = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'resource-exists'
      );

      expect(resourceErrors).toHaveLength(1);
      expect(resourceErrors[0]?.message).toContain('db.main');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('warns on contour cycles declared across files', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'user.ts'),
        `import { contour } from '@ontrails/core';
import { z } from 'zod';
import { gist } from './gist';

export const user = contour('user', {
  gistId: gist.id(),
  id: z.string().uuid(),
}, { identity: 'id' });`
      );
      writeFileSync(
        join(dir, 'gist.ts'),
        `import { contour } from '@ontrails/core';
import { z } from 'zod';
import { user } from './user';

export const gist = contour('gist', {
  id: z.string().uuid(),
  ownerId: user.id(),
}, { identity: 'id' });`
      );

      const report = await runWarden({ rootDir: dir });
      const circularWarnings = report.diagnostics.filter(
        (diagnostic) => diagnostic.rule === 'circular-refs'
      );

      expect(circularWarnings.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('uses project context for store factory completeness across files', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'store.ts'),
        `import { Result, resource } from '@ontrails/core';
import { store } from '@ontrails/store';
import { crud } from '@ontrails/store/trails';
import { z } from 'zod';

export const definition = store({
  notes: {
    identity: 'id',
    schema: z.object({
      id: z.string(),
      title: z.string(),
    }),
    versioned: true,
  },
});

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const noteTrails = crud(definition.tables.notes, notesResource);`
      );
      writeFileSync(
        join(dir, 'reconcile.ts'),
        `import { Result, resource } from '@ontrails/core';
import { reconcile } from '@ontrails/store/trails';
import { definition } from './store';

const notesResource = resource('db.notes', {
  create: () => Result.ok({}),
  mock: () => ({}),
});

const reconcileNotes = reconcile({
  resource: notesResource,
  table: definition.tables.notes,
});`
      );
      writeFileSync(
        join(dir, 'listener.ts'),
        `import { Result, trail } from '@ontrails/core';
import { definition } from './store';
import { z } from 'zod';

trail('notes.notify', {
  on: [
    definition.tables.notes.signals.created,
    definition.tables.notes.signals.updated,
    definition.tables.notes.signals.removed,
  ],
  blaze: async () => Result.ok({ ok: true }),
  output: z.object({ ok: z.boolean() }),
});`
      );

      const report = await runWarden({ rootDir: dir });

      expect(
        report.diagnostics.filter(
          (diagnostic) => diagnostic.rule === 'missing-reconcile'
        )
      ).toHaveLength(0);
      expect(
        report.diagnostics.filter(
          (diagnostic) => diagnostic.rule === 'orphaned-signal'
        )
      ).toHaveLength(0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('runWarden draft markers', () => {
  test('requires draft-bearing files to be visibly marked', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'draft-id.ts'),
        `trail("_draft.entity.prepare", {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({})
})`
      );

      const report = await runWarden({ rootDir: dir });

      const hasDraftFileMarking = report.diagnostics.some((diagnostic) =>
        isDraftFileMarking(diagnostic.rule)
      );
      const hasDraftVisibleDebt = report.diagnostics.some((diagnostic) =>
        isDraftVisibleDebt(diagnostic.rule)
      );

      expect(hasDraftFileMarking).toBe(true);
      expect(hasDraftVisibleDebt).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('allows correctly marked draft files while keeping the debt visible', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, '_draft.entity.ts'),
        `trail("_draft.entity.prepare", {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({})
})`
      );

      const report = await runWarden({ rootDir: dir });

      const hasDraftFileMarkingError = report.diagnostics.some((diagnostic) =>
        isDraftFileMarkingError(diagnostic)
      );
      const hasDraftVisibleDebt = report.diagnostics.some((diagnostic) =>
        isDraftVisibleDebt(diagnostic.rule)
      );

      expect(hasDraftFileMarkingError).toBe(false);
      expect(hasDraftVisibleDebt).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('warns when a draft-marked file no longer contains draft ids', async () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, 'entity.draft.ts'),
        `trail("entity.prepare", {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({})
})`
      );

      const report = await runWarden({ rootDir: dir });

      const hasDraftFileMarkingWarn = report.diagnostics.some((diagnostic) =>
        isDraftFileMarkingWarn(diagnostic)
      );

      expect(hasDraftFileMarkingWarn).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('formatWardenReport', () => {
  test('formats a clean report', () => {
    const output = formatWardenReport({
      diagnostics: [],
      drift: { committedHash: null, currentHash: 'stub', stale: false },
      errorCount: 0,
      passed: true,
      warnCount: 0,
    });
    expect(output).toContain('Warden Report');
    expect(output).toContain('Lint: clean');
    expect(output).toContain('Drift: clean');
    expect(output).toContain('Result: PASS');
  });

  test('formats a report with errors', () => {
    const output = formatWardenReport({
      diagnostics: [
        {
          filePath: 'src/trails/entity.ts',
          line: 3,
          message: 'Do not throw inside implementation.',
          rule: 'no-throw-in-implementation',
          severity: 'error',
        },
      ],
      drift: { committedHash: null, currentHash: 'stub', stale: false },
      errorCount: 1,
      passed: false,
      warnCount: 0,
    });
    expect(output).toContain('1 errors');
    expect(output).toContain('Result: FAIL');
    expect(output).toContain('entity.ts:3');
  });

  test('formats a report with stale drift', () => {
    const output = formatWardenReport({
      diagnostics: [],
      drift: { committedHash: 'abc', currentHash: 'def', stale: true },
      errorCount: 0,
      passed: false,
      warnCount: 0,
    });
    expect(output).toContain('trails.lock is stale');
    expect(output).toContain('Result: FAIL');
  });

  test('formats a report with blocked established exports', () => {
    const output = formatWardenReport({
      diagnostics: [],
      drift: {
        blockedReason:
          'Established topo validation failed with 1 draft issue(s)',
        committedHash: null,
        currentHash: 'blocked',
        stale: true,
      },
      errorCount: 0,
      passed: false,
      warnCount: 0,
    });
    expect(output).toContain('Drift: blocked');
    expect(output).toContain('established exports blocked');
  });
});
