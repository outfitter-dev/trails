/**
 * Flaky local test server for the lookout fast-mode demo.
 *
 * Serves two endpoints so the quickstart can watch the full reactive loop:
 *
 * - `/steady` always answers 200 — a check against it stays up.
 * - `/flaky` cycles through a scripted phase pattern: healthy for a few
 *   requests, then a transient blip (one 503 followed by recovery — the
 *   detour demo), then a hard outage (sustained 503s — the incident demo),
 *   then healthy again (incident resolves).
 *
 * Run with: bun run flaky-server (defaults to port 4090).
 */

const port = Number(process.env['PORT'] ?? 4090);

/**
 * Response script for `/flaky`, consumed one entry per request and repeated
 * from the start when exhausted. `ok` answers 200, `fail` answers 503.
 *
 * The shape is tuned for fast mode (2s probe interval): a transient blip that
 * a single retry clears, then an outage long enough to open an incident, then
 * recovery.
 */
const phases: readonly ('ok' | 'fail')[] = [
  'ok',
  'ok',
  // Transient blip: the probe's first attempt sees 503, its detour retry
  // lands on the next entry (ok) → recovered-after-retry.
  'fail',
  'ok',
  'ok',
  // Hard outage: every attempt fails → check goes down, incident opens.
  'fail',
  'fail',
  'fail',
  'fail',
  'fail',
  'fail',
  'fail',
  'fail',
  // Recovery: check comes back up, incident resolves.
  'ok',
  'ok',
  'ok',
];

let cursor = 0;

const server = Bun.serve({
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/steady') {
      return new Response('steady: ok\n', { status: 200 });
    }
    if (path === '/flaky') {
      const phase = phases[cursor % phases.length] ?? 'ok';
      cursor += 1;
      if (phase === 'fail') {
        console.log(`flaky-server: /flaky #${cursor} -> 503`);
        return new Response('flaky: unavailable\n', { status: 503 });
      }
      console.log(`flaky-server: /flaky #${cursor} -> 200`);
      return new Response('flaky: ok\n', { status: 200 });
    }
    return new Response('not found\n', { status: 404 });
  },
  port,
});

console.log(`flaky-server listening on http://localhost:${server.port}`);
console.log('  /steady  always 200');
console.log(
  '  /flaky   scripted: ok, blip (one 503), outage (503 x8), recovery'
);
