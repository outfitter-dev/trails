import type { Rule } from '@oxlint/plugins';

import { noConsoleInPackagesRule } from './no-console-in-packages.js';
import { noDeepRelativeImportRule } from './no-deep-relative-import.js';
import { noNestedBarrelRule } from './no-nested-barrel.js';
import { noProcessEnvInPackagesRule } from './no-process-env-in-packages.js';
import { noProcessExitInPackagesRule } from './no-process-exit-in-packages.js';
import { preferBunApiRule } from './prefer-bun-api.js';
import { snapshotLocationRule } from './snapshot-location.js';
import { testFileNamingRule } from './test-file-naming.js';

export const rules = {
  'no-console-in-packages': noConsoleInPackagesRule,
  'no-deep-relative-import': noDeepRelativeImportRule,
  'no-nested-barrel': noNestedBarrelRule,
  'no-process-env-in-packages': noProcessEnvInPackagesRule,
  'no-process-exit-in-packages': noProcessExitInPackagesRule,
  'prefer-bun-api': preferBunApiRule,
  'snapshot-location': snapshotLocationRule,
  'test-file-naming': testFileNamingRule,
} satisfies Record<string, Rule>;
