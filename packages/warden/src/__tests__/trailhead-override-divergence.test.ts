import { describe, expect, test } from 'bun:test';

import { trailheadOverrideDivergence } from '../rules/trailhead-override-divergence.js';
import type {
  AuthoredMcpSurfaceBindingSet,
  ProjectContext,
} from '../rules/types.js';

const FILE = 'src/mcp-options.ts';

const operatorSet = (
  bindings: AuthoredMcpSurfaceBindingSet['bindings']
): AuthoredMcpSurfaceBindingSet => ({
  appName: 'trails',
  bindings,
  trailIds: ['survey', 'survey.brief', 'survey.diff', 'topo'],
});

const contextWith = (
  sets?: readonly AuthoredMcpSurfaceBindingSet[]
): ProjectContext => ({
  ...(sets === undefined ? {} : { authoredMcpSurfaceBindingSets: sets }),
  knownTrailIds: new Set<string>(),
});

const alignedSource = `export const trailsMcpTrailheads = {
  inspect: {
    description: 'Inspect topo state.',
    trails: ['survey', 'survey.brief'],
  },
};`;

describe('trailhead-override-divergence', () => {
  test('stays quiet when the call-site map matches the authored binding', () => {
    const diagnostics = trailheadOverrideDivergence.checkWithContext(
      alignedSource,
      FILE,
      contextWith([operatorSet({ inspect: ['survey', 'survey.brief'] })])
    );

    expect(diagnostics).toEqual([]);
  });

  test('member order does not count as divergence', () => {
    const diagnostics = trailheadOverrideDivergence.checkWithContext(
      alignedSource,
      FILE,
      contextWith([operatorSet({ inspect: ['survey.brief', 'survey'] })])
    );

    expect(diagnostics).toEqual([]);
  });

  test('warns when the call-site trailhead name has no authored binding', () => {
    const diagnostics = trailheadOverrideDivergence.checkWithContext(
      alignedSource,
      FILE,
      contextWith([operatorSet({ governance: ['survey.diff', 'topo'] })])
    );

    // Both directions diverge here: "inspect" has no authored binding, and
    // authored "governance" is not carried by the call-site map.
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('inspect');
    expect(diagnostics[0]?.message).toContain('"governance"');
    expect(diagnostics[0]?.message).toContain('app "trails"');
    expect(diagnostics[0]?.message).toContain('surfaceOverlay');
    expect(diagnostics[1]?.message).toContain(
      'not carried by this call-site trailhead map'
    );
  });

  test('warns when an authored group is dropped by the call-site override', () => {
    const diagnostics = trailheadOverrideDivergence.checkWithContext(
      alignedSource,
      FILE,
      contextWith([
        operatorSet({
          governance: ['survey.diff', 'topo'],
          inspect: ['survey', 'survey.brief'],
        }),
      ])
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('"governance"');
    expect(diagnostics[0]?.message).toContain(
      'will not be projected at runtime'
    );
    expect(diagnostics[0]?.message).toContain(
      'the committed lock still advertises it'
    );
  });

  test('warns when member selectors diverge and names both sides', () => {
    const diagnostics = trailheadOverrideDivergence.checkWithContext(
      alignedSource,
      FILE,
      contextWith([
        operatorSet({ inspect: ['survey', 'survey.brief', 'survey.diff'] }),
      ])
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('"survey.diff"');
    expect(diagnostics[0]?.message).toContain(
      'selects ["survey", "survey.brief"]'
    );
    expect(diagnostics[0]?.message).toContain(
      'authors ["survey", "survey.brief", "survey.diff"]'
    );
  });

  test('never attributes another app map to a foreign binding set', () => {
    const stashSource = `export const stashTrailheads = {
  snippets: {
    description: 'Snippet lifecycle.',
    trails: ['snippet.create', 'snippet.get'],
  },
};`;

    const diagnostics = trailheadOverrideDivergence.checkWithContext(
      stashSource,
      'examples/stash/src/mcp-options.ts',
      contextWith([operatorSet({ inspect: ['survey', 'survey.brief'] })])
    );

    // The stash map's selectors match no operator trail ids, so the
    // operator's authored bindings never flag it.
    expect(diagnostics).toEqual([]);
  });

  test('scalar mcp bindings are synonyms, not grouped entries, and do not match', () => {
    const diagnostics = trailheadOverrideDivergence.checkWithContext(
      alignedSource,
      FILE,
      contextWith([operatorSet({ inspect: 'survey' })])
    );

    // A scalar binding is a synonym; with no authored groups the rule stays
    // silent instead of comparing against a shape the surface never groups.
    expect(diagnostics).toEqual([]);
  });

  test('skips dynamic selectors instead of double-reporting coherence findings', () => {
    const dynamicSource = `const dynamicIds = ['survey'];
export const trailheads = {
  inspect: {
    description: 'Inspect topo state.',
    trails: dynamicIds,
  },
};`;

    const diagnostics = trailheadOverrideDivergence.checkWithContext(
      dynamicSource,
      FILE,
      contextWith([operatorSet({ inspect: ['survey', 'survey.brief'] })])
    );

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet without authored binding sets or without context', () => {
    expect(
      trailheadOverrideDivergence.checkWithContext(
        alignedSource,
        FILE,
        contextWith()
      )
    ).toEqual([]);
    expect(trailheadOverrideDivergence.check(alignedSource, FILE)).toEqual([]);
  });

  test('recognizes maps through satisfies McpSurfaceTrailheadMap annotations', () => {
    const annotatedSource = `export const map = {
  inspect: {
    description: 'Inspect topo state.',
    trails: ['survey'],
  },
} satisfies McpSurfaceTrailheadMap;`;

    const diagnostics = trailheadOverrideDivergence.checkWithContext(
      annotatedSource,
      FILE,
      contextWith([operatorSet({ inspect: ['survey', 'survey.brief'] })])
    );

    expect(diagnostics).toHaveLength(1);
  });
});
