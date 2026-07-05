#!/usr/bin/env bun

/**
 * Minimal MCP stdio client for the quickstart: spawns `src/mcp.ts`,
 * performs the JSON-RPC handshake, calls one tool, and prints the result.
 *
 * Usage:
 *   JUNCTION_MCP_TOKEN=$(bun bin/mint-token.ts viewer) \
 *     bun bin/mcp-call.ts junction_event_list '{}'
 */

const [toolName, argsJson] = process.argv.slice(2);
if (toolName === undefined) {
  process.stderr.write('Usage: bun bin/mcp-call.ts <tool-name> [args-json]\n');
  process.exit(1);
}

const server = Bun.spawn(['bun', 'src/mcp.ts'], {
  cwd: new URL('..', import.meta.url).pathname,
  stderr: 'inherit',
  stdin: 'pipe',
  stdout: 'pipe',
});

const send = (message: Record<string, unknown>) => {
  server.stdin.write(`${JSON.stringify(message)}\n`);
};

send({
  id: 1,
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    capabilities: {},
    clientInfo: { name: 'junction-quickstart', version: '0.1.0' },
    protocolVersion: '2025-03-26',
  },
});
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({
  id: 2,
  jsonrpc: '2.0',
  method: 'tools/call',
  params: {
    arguments: JSON.parse(argsJson ?? '{}') as Record<string, unknown>,
    name: toolName,
  },
});

const decoder = new TextDecoder();
let buffer = '';
for await (const chunk of server.stdout) {
  buffer += decoder.decode(chunk);
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf('\n');
    if (line.trim().length === 0) {
      continue;
    }
    const message = JSON.parse(line) as {
      id?: number;
      result?: unknown;
      error?: unknown;
    };
    if (message.id === 2) {
      process.stdout.write(
        `${JSON.stringify(message.result ?? message.error, null, 2)}\n`
      );
      server.kill();
      process.exit(message.error === undefined ? 0 : 1);
    }
  }
}
