import { describe, expect, test } from 'bun:test';

import { isMarketplaceLockOnlyDrift } from '../check-skillset-outputs.js';

describe('check-skillset-outputs', () => {
  test('accepts the root lock delta owned by marketplace provenance', () => {
    const isolatedLock = {
      marketplaces: {
        entries: [
          {
            generatedPaths: ['plugin/.claude-plugin/plugin.json'],
            resolved: {
              generatedPaths: ['plugin/.claude-plugin/plugin.json'],
              sourceKind: 'current',
            },
          },
        ],
      },
      provenanceHash: 'sha256:isolated',
      renderResults: [
        {
          outputs: [{ path: '.skillset/cache/latest/.claude/agents/clark.md' }],
        },
      ],
    };
    const liveLock = {
      marketplaces: {
        entries: [
          {
            generatedPaths: [
              '.claude-plugin/marketplace.json',
              'plugin/.claude-plugin/plugin.json',
            ],
            resolved: {
              generatedPaths: [
                '.claude-plugin/marketplace.json',
                'plugin/.claude-plugin/plugin.json',
              ],
              ref: 'release/plugin',
              sha: 'abc123',
              sourceKind: 'current',
            },
          },
        ],
      },
      provenanceHash: 'sha256:marketplace',
      renderResults: [{ outputs: [{ path: '.claude/agents/clark.md' }] }],
    };

    expect(
      isMarketplaceLockOnlyDrift(
        {
          data: { failures: ['stale generated file: skillset.lock'] },
          diagnostics: [
            {
              code: 'generated-output-changed',
              path: 'skillset.lock',
              severity: 'error',
            },
          ],
          ok: false,
        },
        liveLock,
        isolatedLock
      )
    ).toBe(true);
  });

  test('rejects unrelated root lock drift with the expected diagnostic', () => {
    expect(
      isMarketplaceLockOnlyDrift(
        {
          data: { failures: ['stale generated file: skillset.lock'] },
          diagnostics: [
            {
              code: 'generated-output-changed',
              path: 'skillset.lock',
              severity: 'error',
            },
          ],
          ok: false,
        },
        { buildMode: 'updated', provenanceHash: 'sha256:marketplace' },
        { buildMode: 'all', provenanceHash: 'sha256:isolated' }
      )
    ).toBe(false);
  });

  test('rejects drift in any other generated output', () => {
    expect(
      isMarketplaceLockOnlyDrift(
        {
          data: { failures: ['stale generated file: plugin/README.md'] },
          diagnostics: [
            {
              code: 'generated-output-changed',
              path: 'plugin/README.md',
              severity: 'error',
            },
          ],
          ok: false,
        },
        {},
        {}
      )
    ).toBe(false);
  });

  test('rejects additional errors beside marketplace lock drift', () => {
    expect(
      isMarketplaceLockOnlyDrift(
        {
          data: { failures: ['stale generated file: skillset.lock'] },
          diagnostics: [
            {
              code: 'generated-output-changed',
              path: 'skillset.lock',
              severity: 'error',
            },
            {
              code: 'managed-output-diverged',
              path: 'plugin/README.md',
              severity: 'error',
            },
          ],
          ok: false,
        },
        {},
        {}
      )
    ).toBe(false);
  });
});
