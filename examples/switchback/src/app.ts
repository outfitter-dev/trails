import { topo } from '@ontrails/core';

import * as auditLog from './resources/audit.js';
import * as flags from './resources/flags.js';
import * as audit from './trails/audit.js';
import * as evaluate from './trails/evaluate.js';
import * as flagCrud from './trails/flag-crud.js';
import * as flagLifecycle from './trails/flag-lifecycle.js';
import * as rule from './trails/rule.js';

/**
 * The switchback topo: one authored contract consumed as a typed library
 * import, a CLI command, and an MCP tool with zero divergence.
 */
export const app = topo(
  {
    description: 'Feature flags with deterministic, explainable evaluation',
    name: 'switchback',
    version: '0.1.0',
  },
  flags,
  auditLog,
  flagCrud,
  flagLifecycle,
  evaluate,
  rule,
  audit
);
