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

import { graph, trailsOverlays } from '../src/app.js';
import { createStderrLogger } from '../src/logger.js';
import { operatorPermit } from '../src/permit.js';

// oxlint-disable-next-line require-hook -- CLI entry point, not a test file
await surface(graph, {
  createContext: () =>
    createTrailContext({
      logger: createStderrLogger(),
      permit: operatorPermit,
    }),
  overlays: trailsOverlays,
});
