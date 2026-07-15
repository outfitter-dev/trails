#!/usr/bin/env bun

/**
 * Regenerate the committed OpenAPI artifact from the graph.
 *
 * `openapi.json` is a committed rendering of the trail contracts; the
 * artifact test asserts it stays current, and `GET /api/openapi.json`
 * serves the same derivation live.
 */

import { deriveJunctionOpenApiSpec } from '../src/server.js';

const artifactPath = new URL('../openapi.json', import.meta.url).pathname;
await Bun.write(
  artifactPath,
  `${JSON.stringify(deriveJunctionOpenApiSpec(), null, 2)}\n`
);
process.stdout.write(`wrote ${artifactPath}\n`);
