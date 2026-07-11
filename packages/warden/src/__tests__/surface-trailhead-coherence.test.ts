import { describe, expect, test } from 'bun:test';

import { surfaceTrailheadCoherence } from '../rules/surface-trailhead-coherence.js';

const check = (sourceCode: string) =>
  surfaceTrailheadCoherence.check(sourceCode, 'src/mcp-options.ts');

describe('surface-trailhead-coherence', () => {
  test('allows explicit non-overlapping trailhead maps', () => {
    const diagnostics = check(`
import type { McpSurfaceTrailheadMap } from '@ontrails/mcp';

export const trailheads = {
  inspect: {
    description: 'Inspect topo state.',
    trails: ['survey', 'survey.brief'],
  },
  governance: {
    description: 'Run diagnostics.',
    trails: ['warden', 'doctor'],
  },
} satisfies McpSurfaceTrailheadMap;
`);

    expect(diagnostics).toEqual([]);
  });

  test('flags selectors that overlap across trailheads', () => {
    const diagnostics = check(`
export const trailheads = {
  inspect: {
    description: 'Inspect topo state.',
    trails: ['survey.*'],
  },
  detail: {
    description: 'Inspect one topo detail.',
    trails: ['survey.trail'],
  },
};
`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('overlaps selector');
    expect(diagnostics[0]?.message).toContain('survey.trail');
  });

  test('flags missing descriptions and dynamic selectors', () => {
    const diagnostics = check(`
const selector = 'survey';
export const trailheads = {
  inspect: {
    trails: selector,
  },
};
`);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((item) => item.message).join('\n')).toContain(
      'dynamic trails selector'
    );
    expect(diagnostics.map((item) => item.message).join('\n')).toContain(
      'non-empty description'
    );
  });

  test('flags public visibility widening without acceptance metadata', () => {
    const diagnostics = check(`
export const trailheads = {
  inspect: {
    description: 'Inspect topo state.',
    trails: ['survey'],
    visibility: 'public',
  },
};
`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('visibilityWideningAccepted');
  });

  test('requires stable description metadata when widening is accepted', () => {
    const diagnostics = check(`
export const trailheads = {
  inspect: {
    description: 'Inspect topo state.',
    trails: ['survey'],
    visibility: 'public',
    visibilityWideningAccepted: true,
  },
};
`);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('descriptionStableThrough');
  });

  test('recognizes inline trailheads options', () => {
    const diagnostics = check(`
export const options = {
  trailheads: {
    inspect: {
      description: 'Inspect topo state.',
      trails: ['survey'],
    },
    governance: {
      description: 'Run diagnostics.',
      trails: ['warden'],
    },
  },
};
`);

    expect(diagnostics).toEqual([]);
  });

  test('ignores non-trailhead objects that include trails summary counts', () => {
    const diagnostics = check(`
export const lockManifest = {
  summary: {
    entities: 1,
    resources: 2,
    signals: 3,
    trails: 4,
  },
};
`);

    expect(diagnostics).toEqual([]);
  });
});
