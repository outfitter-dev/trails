import { NotFoundError, Result, topo, trail } from '@ontrails/core';
import { createWorkersHandler } from '@ontrails/cloudflare/workers';
import { z } from 'zod';

const ping = trail('ping', {
  implementation: () => Result.ok({ reply: 'pong' }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});
const missing = trail('missing', {
  implementation: () => Result.err(new NotFoundError('authored missing')),
  input: z.object({}),
  intent: 'read',
  output: z.object({}),
});
export default createWorkersHandler(topo('assets-worker', { missing, ping }), {
  host: { assets: { binding: 'ASSETS' }, mcp: { path: '/mcp' } },
  mcp: () => async () => new Response('MCP test double', { status: 404 }),
});
