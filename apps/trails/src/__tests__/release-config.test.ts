import { describe, expect, test } from 'bun:test';

import {
  defaultReleaseConfig,
  releaseConfigSchema,
  releaseFactTypeValues,
} from '../release/index.js';

describe('release config schema', () => {
  test('defaults to package and public contract release rules', () => {
    expect(defaultReleaseConfig.rules.map((rule) => rule.id)).toEqual([
      'package-content-requires-intent',
      'public-trail-contract-requires-intent',
    ]);
    expect(defaultReleaseConfig.rules.map((rule) => rule.facts)).toEqual([
      ['package-content'],
      ['public-trail-contract'],
    ]);
  });

  test('accepts project-defined release rules', () => {
    const config = releaseConfigSchema.parse({
      rules: [
        {
          facts: ['public-trail-contract'],
          id: 'public-contracts-warn-only',
          intent: ['changeset'],
          severity: 'warning',
        },
      ],
    });

    expect(config.rules).toEqual([
      {
        enabled: true,
        facts: ['public-trail-contract'],
        id: 'public-contracts-warn-only',
        intent: ['changeset'],
        severity: 'warning',
      },
    ]);
  });

  test('keeps fact type vocabulary tight', () => {
    expect(releaseFactTypeValues).toEqual([
      'package-content',
      'public-trail-contract',
    ]);
  });
});
