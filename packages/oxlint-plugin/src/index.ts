import { definePlugin, eslintCompatPlugin } from '@oxlint/plugins';

import { rules } from './rules/registry.js';

/**
 * Private Oxlint plugin loaded by this repository's root `oxlint.config.ts`.
 *
 * @remarks
 * This package is for Trails repo-local hygiene and temporary hardening checks.
 * Durable framework correctness belongs in Warden.
 */
const plugin = eslintCompatPlugin(
  definePlugin({
    meta: {
      name: '@ontrails/oxlint-plugin',
    },
    rules,
  })
);

export { rules } from './rules/registry.js';
export default plugin;
