import { describe, expect, test } from 'bun:test';

import type { WardenGuideManifest } from '@ontrails/warden';

import {
  WARDEN_GUIDE_END,
  WARDEN_GUIDE_START,
  renderAgentsWardenGuideBlock,
  replaceAgentsWardenGuideBlock,
} from '../sync-agents-warden-guide.js';

const manifestFixture = {
  generatedFrom: {
    package: '@ontrails/warden',
    registries: ['wardenRules', 'wardenTopoRules'],
    source: 'builtin-rule-metadata',
  },
  kind: 'trails-warden-guide-manifest',
  ruleCount: 1,
  rules: [
    {
      concern: 'results',
      depth: 'source',
      description: 'Prevents thrown trail failures.',
      docs: [],
      id: 'no-throw-in-implementation',
      invariant: 'Trail implementations return Result values.',
      lifecycle: { state: 'durable' },
      scope: 'external',
      severity: 'error',
      tier: 'source-static',
    },
  ],
  version: 1,
} satisfies WardenGuideManifest;

describe('sync-agents-warden-guide', () => {
  test('renders a generated block from the Warden manifest', () => {
    const block = renderAgentsWardenGuideBlock(manifestFixture);

    expect(block).toStartWith(WARDEN_GUIDE_START);
    expect(block).toContain(
      '- Guide input command: `bun apps/trails/bin/trails.ts warden guide --manifest`'
    );
    expect(block).toContain('- Rule count: 1');
    expect(block).toContain('#### Results');
    expect(block).toMatch(
      /- `no-throw-in-implementation` \(error, source\/source-static, external\): Trail implementations return Result values\./
    );
    expect(block).toEndWith(WARDEN_GUIDE_END);
  });

  test('replaces an existing generated block without touching surrounding prose', () => {
    const source = [
      '# AGENTS.md',
      '',
      'Before.',
      '',
      WARDEN_GUIDE_START,
      'old',
      WARDEN_GUIDE_END,
      '',
      'After.',
      '',
    ].join('\n');
    const replacement = `${WARDEN_GUIDE_START}\nnew\n${WARDEN_GUIDE_END}`;

    expect(replaceAgentsWardenGuideBlock(source, replacement)).toBe(
      ['# AGENTS.md', '', 'Before.', '', replacement, '', 'After.', ''].join(
        '\n'
      )
    );
  });

  test('inserts a missing generated section before Draft State', () => {
    const source = [
      '# AGENTS.md',
      '',
      '## Trail Rules',
      '',
      'Human.',
      '',
      '## Draft State',
      '',
      'Drafts.',
    ].join('\n');
    const replacement = `${WARDEN_GUIDE_START}\nnew\n${WARDEN_GUIDE_END}`;
    const updated = replaceAgentsWardenGuideBlock(source, replacement);

    expect(updated).toContain('## Warden Rule Guide');
    expect(updated.indexOf('## Warden Rule Guide')).toBeLessThan(
      updated.indexOf('## Draft State')
    );
    expect(updated).toContain(replacement);
  });

  test('rejects orphaned start-only generated block markers', () => {
    const replacement = `${WARDEN_GUIDE_START}\nnew\n${WARDEN_GUIDE_END}`;
    const source = [
      '# AGENTS.md',
      '',
      WARDEN_GUIDE_START,
      'old',
      '',
      '## Draft State',
      '',
      'Drafts.',
    ].join('\n');

    expect(() => replaceAgentsWardenGuideBlock(source, replacement)).toThrow(
      'found only one Warden guide marker'
    );
  });

  test('rejects orphaned end-only generated block markers', () => {
    const replacement = `${WARDEN_GUIDE_START}\nnew\n${WARDEN_GUIDE_END}`;
    const source = [
      '# AGENTS.md',
      '',
      WARDEN_GUIDE_END,
      '',
      '## Draft State',
      '',
      'Drafts.',
    ].join('\n');

    expect(() => replaceAgentsWardenGuideBlock(source, replacement)).toThrow(
      'found only one Warden guide marker'
    );
  });
});
