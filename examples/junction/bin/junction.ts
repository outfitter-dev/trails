#!/usr/bin/env bun

/**
 * CLI entry: ops commands derived from the same graph.
 *
 * `--token <jwt>` resolves through the same JWT boundary as HTTP and MCP,
 * so one permit declaration guards all three surfaces.
 */

import { outputModePreset, permitPreset, tokenPreset } from '@ontrails/cli';
import { surface } from '@ontrails/commander';

import { graph } from '../src/app.js';
import { authConfigValues, resolveCliPermit } from '../src/permits.js';

// oxlint-disable-next-line require-hook -- CLI entry point, not a test file
await surface(graph, {
  configValues: authConfigValues(),
  presets: [outputModePreset(), permitPreset(), tokenPreset()],
  resolvePermitFromToken: resolveCliPermit,
});
