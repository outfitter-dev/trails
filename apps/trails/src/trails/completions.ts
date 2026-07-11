/**
 * `completions` trail -- Print a shell completion script for the `trails` CLI.
 *
 * The trail's responsibility is small: render a static shell script that, when
 * sourced by the user's shell, registers a tab-completion handler that
 * delegates to `trails completions __complete <args...>` for the live
 * suggestions. See {@link renderCompletionScript} for the per-shell shape.
 */

import { trail } from '@ontrails/core';
import { z } from 'zod';

import { renderCompletionScript } from '../completions.js';

const COMPLETIONS_BIN_NAME = 'trails';

export const completionsTrail = trail('completions', {
  args: ['shell'],
  description:
    'Print a shell completion script for the trails CLI; pipe into your shell rc to register tab-completion',
  examples: [
    {
      description: 'Render a bash completion script',
      input: { shell: 'bash' },
      name: 'Render bash completion',
    },
    {
      description: 'Render a zsh completion script',
      input: { shell: 'zsh' },
      name: 'Render zsh completion',
    },
    {
      description: 'Render a fish completion script',
      input: { shell: 'fish' },
      name: 'Render fish completion',
    },
  ],
  implementation: async (input) =>
    renderCompletionScript(input.shell, COMPLETIONS_BIN_NAME),
  input: z.object({
    shell: z
      .enum(['bash', 'zsh', 'fish'])
      .describe('Target shell flavor for the completion script'),
  }),
  intent: 'read',
  output: z.string(),
});
