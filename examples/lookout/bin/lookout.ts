#!/usr/bin/env bun

/**
 * CLI entry point for lookout.
 *
 * Usage:
 *   bun bin/lookout.ts check create --name api --url https://example.com --interval-seconds 60
 *   bun bin/lookout.ts status
 *   bun bin/lookout.ts incident list
 *   bun bin/lookout.ts dev --fast
 *
 * `dev` is the runtime orchestrator (schedule runtime + HTTP status page),
 * not a trail; everything else derives from the trail contracts. The local
 * CLI runs as the operator, so admin-permit trails work without token
 * ceremony — the HTTP surface keeps admin behind a bearer token.
 */

import { surface } from '@ontrails/commander';
import { createTrailContext } from '@ontrails/core';

import { graph } from '../src/app.js';
import { runDev } from '../src/dev.js';

const OPERATOR_PERMIT = {
  id: 'local-operator',
  scopes: ['lookout:admin'],
};

await (process.argv[2] === 'dev'
  ? runDev({ fast: process.argv.includes('--fast') })
  : surface(graph, {
      createContext: () => createTrailContext({ permit: OPERATOR_PERMIT }),
    }));
