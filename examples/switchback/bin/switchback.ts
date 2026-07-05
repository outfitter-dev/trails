#!/usr/bin/env bun

/**
 * CLI entry point for switchback.
 *
 * Usage:
 *   bun run bin/switchback.ts flag list
 *   bun run bin/switchback.ts flag evaluate --key checkout-v2 \
 *     --context '{"subjectId":"user-1","attributes":{"plan":"beta"}}' --explain
 */

import { surface } from '@ontrails/commander';

import { app } from '../src/app.js';

// oxlint-disable-next-line require-hook -- CLI entry point, not a test file
await surface(app);
