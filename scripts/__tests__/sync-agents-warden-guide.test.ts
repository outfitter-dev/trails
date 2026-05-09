import { describe, expect, test } from 'bun:test';

import {
  WARDEN_GUIDE_END,
  WARDEN_GUIDE_START,
  renderAgentsWardenGuideBlock,
  replaceAgentsWardenGuideBlock,
} from '../sync-agents-warden-guide.js';

describe('sync-agents-warden-guide', () => {
  test('renders a generated block from the live Warden manifest', () => {
    const block = renderAgentsWardenGuideBlock();

    expect(block).toStartWith(WARDEN_GUIDE_START);
    expect(block).toMatch(/Rule count: \d+/);
    expect(block).toContain('#### Results');
    expect(block).toContain('`no-throw-in-implementation`');
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

  test('rejects orphaned generated block markers', () => {
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
});
