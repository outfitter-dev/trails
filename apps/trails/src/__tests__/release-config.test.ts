import { describe, expect, test } from 'bun:test';

import {
  defaultReleaseConfig,
  releaseConfigSchema,
  releaseFactTypeValues,
} from '../release/index.js';

describe('release config schema', () => {
  test('defaults to package, package-route, and public contract release rules', () => {
    expect(defaultReleaseConfig.rules.map((rule) => rule.id)).toEqual([
      'public-package-route-requires-regrade',
      'package-content-requires-intent',
      'public-trail-contract-requires-intent',
    ]);
    expect(defaultReleaseConfig.rules.map((rule) => rule.facts)).toEqual([
      ['public-package-route'],
      ['package-content'],
      ['public-trail-contract'],
    ]);
    expect(defaultReleaseConfig.rules[0]?.intent).toEqual(['changeset']);
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
      'public-package-route',
      'public-trail-contract',
    ]);
  });
});
