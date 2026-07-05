#!/usr/bin/env bun

/**
 * packlist CLI — commands, flags, aliases, help text, and exit codes all
 * derive from the trail contracts in `src/app.ts`.
 *
 * The injected context carries the local operator permit (no auth UX in
 * this showcase — `junction` owns the permits story) and a stderr logger so
 * signal consumers like `pack.recalculate` are visible in normal output.
 */

import { createTrailContext } from '@ontrails/core';
import { surface } from '@ontrails/commander';

import { graph } from '../src/app.js';
import { createStderrLogger } from '../src/logger.js';
import { operatorPermit } from '../src/permit.js';

/**
 * Surface-owned CLI aliases, kept here (not exported from `src/app.ts`)
 * because `trails compile` embeds app-module aliases into the lock graph
 * while Warden's drift check derives the fresh graph without them, which
 * would report the committed lock as permanently stale.
 *
 * TODO ::: trails-gap: warden drift ignores cliAliases that compile embeds,
 * so alias-exporting app modules never pass the drift check. Open as
 * TRL-1179; move the aliases back to `src/app.ts` once it lands.
 */
const cliAliases = {
  'gear.create': [['gear', 'add']],
  'gear.list': [['gear', 'ls']],
  'gear.read': [['gear', 'get']],
  'pack.list': [['pack', 'ls']],
  'pack.read': [['pack', 'get']],
  'trip.list': [['trip', 'ls']],
  'trip.read': [['trip', 'get']],
} as const;

// oxlint-disable-next-line require-hook -- CLI entry point, not a test file
await surface(graph, {
  aliases: cliAliases,
  createContext: () =>
    createTrailContext({
      logger: createStderrLogger(),
      permit: operatorPermit,
    }),
});
