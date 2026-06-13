import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { cliCommandRouteCoherence } from '../rules/cli-command-route-coherence.js';
import { wrapTopoRule } from './wrap-rule.js';

const searchTrail = trail('wayfind.search', {
  blaze: () => Result.ok([]),
  cli: {
    aliases: ['find'],
  },
  input: z.object({ query: z.string() }),
  output: z.array(z.string()),
});

const collidingTrail = trail('wayfind.find', {
  blaze: () => Result.ok([]),
  input: z.object({ query: z.string() }),
  output: z.array(z.string()),
});

export const cliCommandRouteCoherenceTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'CLI command route collision on "wayfind find": canonical route for trail "wayfind.find" (derived), alias route for trail "wayfind.search" (trail). Rename or remove one CLI alias so every accepted command path normalizes into exactly one trail contract.',
            rule: 'cli-command-route-coherence',
            severity: 'error',
          },
        ],
      },
      input: {
        topo: topo('cli-command-route-coherence', {
          collidingTrail,
          searchTrail,
        }),
      },
      name: 'CLI alias colliding with another command route',
    },
  ],
  rule: cliCommandRouteCoherence,
});
