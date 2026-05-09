import { describe, expect, test } from 'bun:test';
import { testAll } from '@ontrails/testing';

import { diagnosticSchema } from '../trails/schema.js';
import { wardenTopo } from '../trails/topo.js';

// oxlint-disable-next-line jest/require-hook -- testAll generates describe/test blocks, not setup code
testAll(wardenTopo);

describe('wardenTopo', () => {
  test('contains all 48 rule trails', () => {
    expect(wardenTopo.count).toBe(48);
  });

  test('all trail IDs follow warden.rule.* naming', () => {
    for (const id of wardenTopo.ids()) {
      expect(id).toMatch(/^warden\.rule\./);
    }
  });

  test('all rule trails expose Warden metadata', () => {
    for (const trail of wardenTopo.list()) {
      const metadata = trail.meta?.warden as
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
          summary: 'Convert thrown failures into Result outcomes.',
        },
        line: 1,
        message: 'Do not throw inside implementation.',
        rule: 'no-throw-in-implementation',
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
        message: 'Do not throw inside implementation.',
        rule: 'no-throw-in-implementation',
        severity: 'error',
      }).success
    ).toBe(true);
  });
});
