#!/usr/bin/env bun

/**
 * Mint a junction JWT for the quickstart and local ops.
 *
 * Usage:
 *   bun bin/mint-token.ts admin
 *   bun bin/mint-token.ts viewer
 *
 * Signs with `JUNCTION_JWT_SECRET` (falling back to the dev secret) so the
 * output works against a locally started `bin/serve.ts` out of the box.
 */

import { jwtSecret } from '../src/permits.js';
import { mintToken, roles } from '../src/tokens.js';
import type { Role } from '../src/tokens.js';

const [role] = process.argv.slice(2);
if (role === undefined || !(roles as readonly string[]).includes(role)) {
  process.stderr.write(`Usage: bun bin/mint-token.ts <${roles.join('|')}>\n`);
  process.exit(1);
}

process.stdout.write(
  `${mintToken({ role: role as Role, secret: jwtSecret() })}\n`
);
