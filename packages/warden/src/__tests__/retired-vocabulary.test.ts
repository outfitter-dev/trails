import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';

import {
  formatGovernedVocabularyTransitionGuide,
  getGovernedVocabularyTransition,
  governedVocabularyRegistrySchema,
  governedVocabularyTransitions,
  listGovernedVocabularyTransitions,
} from '../rules/retired-vocabulary.js';

describe('governed vocabulary registry', () => {
  test('accounts for current pending v1 lexicon families', () => {
    const transitions = listGovernedVocabularyTransitions();

    expect(transitions.map((transition) => transition.id)).toEqual([
      'cross-compose',
      'v1-blaze-implementation',
      'v1-contour-entity',
      'v1-facet-trailhead',
      'v1-projection-derive-render',
    ]);
    expect(transitions.map((transition) => transition.from)).toEqual([
      'cross',
      'blaze',
      'contour',
      'facet',
      'projection',
    ]);

    const projection = getGovernedVocabularyTransition(
      'v1-projection-derive-render'
    );
    expect(projection?.oldForms).toContain('project');
    expect(projection?.target.kind).toBe('classified');

    const facet = getGovernedVocabularyTransition('v1-facet-trailhead');
    expect(facet?.status).toBe('complete');
  });

  test('validates registry shape and rejects incomplete entries', () => {
    expect(() =>
      governedVocabularyRegistrySchema.parse([
        {
          docs: { summary: 'missing target' },
          from: 'old',
          id: 'bad',
          intent: 'bad entry',
          kind: 'vocabulary',
          oldForms: ['old'],
          status: 'planned',
        },
      ])
    ).toThrow(ZodError);
  });

  test('keeps v1 vocabulary transitions from rewriting the registry itself', () => {
    const v1Transitions = listGovernedVocabularyTransitions().filter(
      (transition) => transition.id.startsWith('v1-')
    );

    expect(v1Transitions.length).toBeGreaterThan(0);
    for (const transition of v1Transitions) {
      expect(transition.scope?.exclude).toContain(
        'packages/warden/src/rules/retired-vocabulary.ts'
      );
    }
  });

  test('rejects duplicate ids and duplicate source terms', () => {
    const [transition] = governedVocabularyTransitions;
    if (transition === undefined) {
      throw new Error('Expected governed vocabulary registry fixture.');
    }

    expect(() =>
      governedVocabularyRegistrySchema.parse([transition, transition])
    ).toThrow(ZodError);
  });

  test('renders a documentation guide without making markdown the source of truth', () => {
    const guide = formatGovernedVocabularyTransitionGuide();

    expect(guide).toContain('v1-facet-trailhead: facet -> trailhead');
    expect(guide).toContain('v1-projection-derive-render: projection ->');
    expect(guide).toContain('Status: planned');
  });
});
