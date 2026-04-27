import type { Rule } from '@oxlint/plugins';

import { localPluginSmoke } from './local-plugin-smoke.js';

export const rules = {
  'local-plugin-smoke': localPluginSmoke,
} satisfies Record<string, Rule>;
