/**
 * HTTP surface — the public status page plus the permit-gated admin API.
 *
 * Routes derive from trail ids: `GET /status` (via the status.summary cli/http
 * projection `/status/summary`), `GET /status/badge?checkId=...`,
 * `GET /incident/list`, `GET /probe/history?checkId=...`. Public reads need
 * no auth; check management and acknowledge require the
 * `LOOKOUT_ADMIN_TOKEN` bearer token.
 */

import { surface } from '@ontrails/hono';

import { graph } from './app.js';
import { resolveHttpPermit } from './permits.js';

const port = Number(process.env['PORT'] ?? 4091);

// oxlint-disable-next-line require-hook -- HTTP entry point, not a test file
const { url } = await surface(graph, {
  port,
  resolvePermit: resolveHttpPermit,
});

console.log(`lookout status page serving at ${url}`);
