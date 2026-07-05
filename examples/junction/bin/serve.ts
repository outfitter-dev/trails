#!/usr/bin/env bun

/**
 * HTTP server entry. The app itself lives in `src/server.ts`.
 */

import { createServerApp } from '../src/server.js';

const port = Number(process.env['JUNCTION_PORT'] ?? 3000);
const app = createServerApp();
Bun.serve({ fetch: app.fetch, port });
process.stdout.write(`junction listening on http://localhost:${port}\n`);
process.stdout.write('  webhook ingress: POST /hooks/:endpointId\n');
process.stdout.write('  management API:  /api/* (JWT bearer)\n');
process.stdout.write('  openapi:         GET /api/openapi.json\n');
