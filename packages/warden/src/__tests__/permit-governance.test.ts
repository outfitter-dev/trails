import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { permitGovernance } from '../rules/permit-governance.js';

describe('permitGovernance', () => {
  test('renders composed-scope findings through the existing topo rule', async () => {
    const child = trail('entity.remove', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      intent: 'read',
      permit: { scopes: ['entity:remove'] },
    });
    const parent = trail('entity.archive', {
      composes: [child],
      implementation: () => Result.ok({}),
      input: z.object({}),
      intent: 'read',
      permit: 'public',
    });

    const diagnostics = await permitGovernance.checkTopo(
      topo('compose-scope-test', { child, parent })
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        filePath: '<topo>',
        message: expect.stringContaining('entity:remove'),
        rule: 'permit.composeScopeCoverage',
        severity: 'warn',
      }),
    ]);
  });

  test('emits permit diagnostics from the compiled topo', async () => {
    const destroyTrail = trail('entity.delete', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'destroy',
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await permitGovernance.checkTopo(
      topo('permit-topo', { destroyTrail })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Trail "entity.delete" has intent \'destroy\' but no permit declaration',
        rule: 'permit.destroyWithoutPermit',
        severity: 'error',
      },
    ]);
  });

  test('runWarden includes permit governance when topo is supplied', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-permit-'));
    const destroyTrail = trail('entity.delete', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'destroy',
      output: z.object({ ok: z.boolean() }),
    });

    try {
      const report = await runWarden({
        rootDir,
        topo: topo('permit-topo', { destroyTrail }),
      });

      expect(report.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('no permit declaration'),
            rule: 'permit.destroyWithoutPermit',
            severity: 'error',
          }),
        ])
      );
      expect(report.errorCount).toBeGreaterThan(0);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
