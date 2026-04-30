/**
 * End-to-end dispatch test for `TopoAwareWardenRule`.
 *
 * Exercises the CLI → topo-aware rule dispatch path with a no-op mock rule
 * injected via `extraTopoRules`. Proves the plumbing works without shipping
 * any production topo-aware rule.
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTrailContext, topo, trail, Result } from '@ontrails/core';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import type { TopoAwareWardenRule, WardenDiagnostic } from '../rules/types.js';
import { topoAwareRuleInput } from '../trails/schema.js';
import { wrapTopoRule } from '../trails/wrap-rule.js';

const makeTempDir = (): string => {
  const dir = join(
    tmpdir(),
    `warden-topo-aware-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const buildFixtureTopo = () => {
  const echo = trail('fixture.echo', {
    blaze: (input: { value: string }) => Result.ok({ value: input.value }),
    description: 'echo',
    examples: [
      {
        expected: { value: 'a' },
        input: { value: 'a' },
        name: 'roundtrips',
      },
    ],
    input: z.object({ value: z.string() }),
    intent: 'read',
    output: z.object({ value: z.string() }),
  });
  return topo('fixture', { echo });
};

const PLACEHOLDER_FINDING: WardenDiagnostic = {
  filePath: '<topo>',
  line: 1,
  message: 'synthetic topo-level finding',
  rule: 'placeholder-topo-aware',
  severity: 'warn',
};

const buildPlaceholderRule = (seen: string[]): TopoAwareWardenRule => ({
  checkTopo: (inspectedTopo) => {
    seen.push(inspectedTopo.name);
    return [PLACEHOLDER_FINDING];
  },
  description: 'placeholder rule returning one diagnostic',
  name: 'placeholder-topo-aware',
  severity: 'warn',
});

describe('TopoAwareWardenRule dispatch', () => {
  test('CLI dispatches injected topo-aware rules and aggregates diagnostics into the report', async () => {
    const dir = makeTempDir();
    try {
      const seen: string[] = [];
      const report = await runWarden({
        extraTopoRules: [buildPlaceholderRule(seen)],
        lintOnly: true,
        rootDir: dir,
        topo: buildFixtureTopo(),
      });
      const emitted = report.diagnostics.filter(
        (d) => d.rule === 'placeholder-topo-aware'
      );

      expect(seen).toEqual(['fixture']);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(PLACEHOLDER_FINDING);
      expect(report.warnCount).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI dispatches topo-aware tier rules when selected explicitly', async () => {
    const dir = makeTempDir();
    try {
      const seen: string[] = [];
      const report = await runWarden({
        extraTopoRules: [buildPlaceholderRule(seen)],
        rootDir: dir,
        tier: 'topo-aware',
        topo: buildFixtureTopo(),
      });

      expect(seen).toEqual(['fixture']);
      expect(
        report.diagnostics.some((d) => d.rule === 'placeholder-topo-aware')
      ).toBe(true);
      expect(report.drift).toBeNull();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI skips topo-aware rules when another tier is selected', async () => {
    const dir = makeTempDir();
    try {
      const seen: string[] = [];
      await runWarden({
        extraTopoRules: [buildPlaceholderRule(seen)],
        rootDir: dir,
        tier: 'source-static',
        topo: buildFixtureTopo(),
      });

      expect(seen).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI skips topo-aware rules when no topo is provided', async () => {
    const dir = makeTempDir();
    try {
      let invoked = false;
      const placeholder: TopoAwareWardenRule = {
        checkTopo: () => {
          invoked = true;
          return [];
        },
        description: 'placeholder',
        name: 'placeholder-unused',
        severity: 'warn',
      };

      await runWarden({
        extraTopoRules: [placeholder],
        lintOnly: true,
        rootDir: dir,
      });

      expect(invoked).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('wrapTopoRule flows diagnostics through the trail pipeline', async () => {
    const diagnostic: WardenDiagnostic = {
      filePath: '<topo>',
      line: 1,
      message: 'synthetic finding',
      rule: 'synthetic-topo-rule',
      severity: 'warn',
    };
    const placeholder: TopoAwareWardenRule = {
      checkTopo: () => [diagnostic],
      description: 'synthetic',
      name: 'synthetic-topo-rule',
      severity: 'warn',
    };

    const wrapped = wrapTopoRule({ examples: [], rule: placeholder });
    const result = await wrapped.blaze(
      { topo: buildFixtureTopo() },
      createTrailContext()
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ diagnostics: [diagnostic] });
    expect(wrapped.id).toBe('warden.rule.synthetic-topo-rule');
  });

  test('CLI awaits async topo-aware rules before aggregating diagnostics', async () => {
    const dir = makeTempDir();
    try {
      const seen: string[] = [];
      const asyncRule: TopoAwareWardenRule = {
        checkTopo(inspectedTopo) {
          seen.push(inspectedTopo.name);
          return Promise.resolve([
            {
              ...PLACEHOLDER_FINDING,
              rule: 'async-placeholder-topo-aware',
            },
          ]);
        },
        description: 'async placeholder',
        name: 'async-placeholder-topo-aware',
        severity: 'warn',
      };

      const report = await runWarden({
        extraTopoRules: [asyncRule],
        lintOnly: true,
        rootDir: dir,
        topo: buildFixtureTopo(),
      });

      expect(seen).toEqual(['fixture']);
      expect(
        report.diagnostics.filter(
          (d) => d.rule === 'async-placeholder-topo-aware'
        )
      ).toEqual([
        { ...PLACEHOLDER_FINDING, rule: 'async-placeholder-topo-aware' },
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('CLI converts thrown topo-aware rule errors into diagnostics', async () => {
    const dir = makeTempDir();
    try {
      const report = await runWarden({
        extraTopoRules: [
          {
            checkTopo: () => {
              throw new Error('graph shape changed unexpectedly');
            },
            description: 'rule that throws',
            name: 'throwing-topo-rule',
            severity: 'error',
          },
        ],
        lintOnly: true,
        rootDir: dir,
        topo: buildFixtureTopo(),
      });

      expect(
        report.diagnostics.filter((d) => d.rule === 'throwing-topo-rule')
      ).toEqual([
        {
          filePath: '<topo>',
          line: 1,
          message:
            'Topo-aware rule "throwing-topo-rule" threw: graph shape changed unexpectedly',
          rule: 'throwing-topo-rule',
          severity: 'error',
        },
      ]);
      expect(report.errorCount).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('topoAwareRuleInput rejects partial topo-shaped objects', () => {
    const result = topoAwareRuleInput.safeParse({
      topo: {
        resources: new Map(),
        trails: new Map(),
      },
    });

    expect(result.success).toBe(false);
  });

  test('wrapTopoRule converts thrown errors into Result.err with InternalError', async () => {
    const throwing: TopoAwareWardenRule = {
      checkTopo: () => {
        throw new Error('graph shape changed unexpectedly');
      },
      description: 'rule that throws',
      name: 'throwing-topo-rule',
      severity: 'error',
    };

    const wrapped = wrapTopoRule({ examples: [], rule: throwing });
    const result = await wrapped.blaze(
      { topo: buildFixtureTopo() },
      createTrailContext()
    );

    expect(result.isErr()).toBe(true);
    const err = result.match({
      err: (e) => e,
      ok: () => {
        throw new Error('expected Result.err');
      },
    });
    expect(err.name).toBe('InternalError');
    expect(err.message).toContain('throwing-topo-rule');
    expect(err.message).toContain('graph shape changed unexpectedly');
  });
});
