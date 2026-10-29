import { Client } from '@modelcontextprotocol/client';
import {
  InMemoryTransport,
  isJSONRPCResultResponse,
} from '@modelcontextprotocol/server';
import type {
  JSONRPCResultResponse,
  Server,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

export const outputProtocolModes = ['legacy', { pin: '2026-07-28' }] as const;

export const connectOutputClient = async (
  factory: () => Server,
  mode: (typeof outputProtocolModes)[number]
) => {
  const client = new Client(
    { name: 'output-test', version: '1' },
    { versionNegotiation: { mode } }
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const responses: JSONRPCResultResponse[] = [];
  const send = serverTransport.send.bind(serverTransport);
  serverTransport.send = (message, options) => {
    if (isJSONRPCResultResponse(message)) {
      responses.push(message);
    }
    return send(message, options);
  };
  const serving = serveStdio(factory, { transport: serverTransport });
  const close = async () => {
    await Promise.allSettled([client.close(), serving.close()]);
  };
  try {
    await client.connect(clientTransport);
  } catch (error) {
    await close();
    throw error;
  }
  return { client, close, responses };
};
