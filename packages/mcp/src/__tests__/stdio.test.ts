import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('stdio keeps startup and invocation warnings off protocol stdout', async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !['BUN_OPTIONS', 'NODE_OPTIONS', 'NODE_NO_WARNINGS'].includes(key)
    )
  );
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL('fixtures/stdio-warning.ts', import.meta.url)),
    ],
    {
      env,
      signal: AbortSignal.timeout(4000),
      stderr: 'pipe',
      stdin: 'pipe',
      stdout: 'pipe',
    }
  );
  const [protocol, capture] = child.stdout.tee();
  const stdout = new Response(capture).text();
  const stderr = new Response(child.stderr).text();
  const reader = protocol.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  const receive = async () => {
    while (!pending.includes('\n')) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error('MCP subprocess closed before its protocol response');
      }
      pending += decoder.decode(chunk.value, { stream: true });
    }
    const boundary = pending.indexOf('\n');
    const message = JSON.parse(pending.slice(0, boundary));
    pending = pending.slice(boundary + 1);
    return message;
  };
  const send = (message: Record<string, unknown>) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };

  try {
    send({
      id: 1,
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'stdio-test', version: '1.0.0' },
        protocolVersion: LATEST_PROTOCOL_VERSION,
      },
    });
    expect(await receive()).toMatchObject({
      id: 1,
      jsonrpc: '2.0',
      result: {},
    });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    const listing = await receive();
    expect(listing.id).toBe(2);
    expect(listing.result.tools).toHaveLength(1);
    const toolName = listing.result.tools[0].name;
    expect(typeof toolName).toBe('string');
    send({
      id: 3,
      method: 'tools/call',
      params: { arguments: { text: 'qualified' }, name: toolName },
    });
    const response = await receive();
    expect(response.id).toBe(3);
    expect(response.result.content).toHaveLength(1);
    expect(response.result.content[0].type).toBe('text');
    expect(JSON.parse(response.result.content[0].text)).toEqual({
      text: 'qualified',
    });
  } finally {
    reader.releaseLock();
    child.kill();
    await child.exited;
  }

  const rawStdout = await stdout;
  const messages = rawStdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(messages.map((message) => message.id)).toEqual([1, 2, 3]);
  expect(messages.every((message) => message.jsonrpc === '2.0')).toBe(true);
  const warnings = await stderr;
  expect(warnings).toContain('TRL1433_START');
  expect(warnings).toContain('TRL1433_CALL');
});
