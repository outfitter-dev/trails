import { describe, expect, test } from 'bun:test';
import { testAll } from '@ontrails/testing';

import { runWardenTrails } from '../trails/run.js';
import { diagnosticSchema } from '../trails/schema.js';
import { wardenTopo } from '../trails/topo.js';

// oxlint-disable-next-line jest/require-hook -- testAll generates describe/test blocks, not setup code
testAll(wardenTopo);

describe('wardenTopo', () => {
  test('contains all 61 rule trails', () => {
    expect(wardenTopo.count).toBe(61);
  });

  test('all trail IDs follow warden.rule.* naming', () => {
    for (const id of wardenTopo.ids()) {
      expect(id).toMatch(/^warden\.rule\./);
    }
  });

  test('all rule trails expose Warden metadata', () => {
    for (const trail of wardenTopo.list()) {
      const metadata = trail.meta?.['warden'] as
        | { lifecycle?: { state?: unknown }; tier?: unknown }
        | undefined;

      expect(typeof metadata?.lifecycle?.state).toBe('string');
      expect(typeof metadata?.tier).toBe('string');
    }
  });

  test('diagnostic schema accepts structured guidance', () => {
    expect(
      diagnosticSchema.safeParse({
        filePath: 'src/trail.ts',
        guidance: {
          docs: [{ label: 'Trail Rules', path: 'AGENTS.md#trail-rules' }],
          steps: ['Return Result.err() instead of throwing.'],
          summary: 'Convert thrown failures in blazes into Result outcomes.',
        },
        line: 1,
        message: 'Do not throw inside the blaze.',
        rule: 'no-throw-in-implementation',
        severity: 'error',
      }).success
    ).toBe(true);
  });

  test('diagnostic schema accepts structured fix metadata', () => {
    expect(
      diagnosticSchema.safeParse({
        filePath: 'src/trail.ts',
        fix: {
          class: 'term-rewrite',
          edits: [{ end: 7, replacement: 'composes', start: 0 }],
          reason: 'Retired term needs a reviewed migration.',
          safety: 'safe',
        },
        line: 1,
        message: 'Retired term used.',
        rule: 'no-retired-cross-vocabulary',
        severity: 'error',
      }).success
    ).toBe(true);
  });

  test('diagnostic schema accepts label-only guidance links', () => {
    expect(
      diagnosticSchema.safeParse({
        filePath: 'src/trail.ts',
        guidance: {
          docs: [{ label: 'Trail Rules' }],
          summary: 'Read the nearby doctrine.',
        },
        line: 1,
        message: 'Do not throw inside the blaze.',
        rule: 'no-throw-in-implementation',
        severity: 'error',
      }).success
    ).toBe(true);
  });

  test('rule trail execution preserves diagnostic fix metadata', async () => {
    const diagnostics = await runWardenTrails(
      '/repo/apps/example/src/cli.ts',
      'export const play = trail("play", { crosses: [] });\n'
    );

    const diagnostic = diagnostics.find(
      (entry) => entry.rule === 'no-retired-cross-vocabulary'
    );

    expect(diagnostic?.fix).toMatchObject({
      class: 'term-rewrite',
      safety: 'safe',
    });
    expect(diagnostic?.fix?.reason).toContain('crosses');
    expect(diagnostic?.fix?.edits).toEqual([
      { end: 43, replacement: 'composes', start: 36 },
    ]);
  });
});
