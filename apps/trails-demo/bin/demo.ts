#!/usr/bin/env bun

/**
 * CLI entry point for trails-demo.
 *
 * Usage:
 *   bun run bin/demo.ts entity show --name Alpha
 *   bun run bin/demo.ts entity add --name Beta --type tool --tags automation
 *   bun run bin/demo.ts search --query Alpha
 */

import { surface } from '@ontrails/cli/commander';

import { app } from '../src/app.js';

// oxlint-disable-next-line require-hook -- CLI entry point, not a test file
await surface(app);
