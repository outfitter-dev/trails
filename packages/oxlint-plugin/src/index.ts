import { definePlugin, eslintCompatPlugin } from '@oxlint/plugins';

import { rules } from './rules/registry.js';

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
