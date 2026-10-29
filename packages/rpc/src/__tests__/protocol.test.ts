import { describe, expect, test } from 'bun:test';

import {
  isReservedRpcMethod,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_PARSE_ERROR,
  parseJsonRpcFrame,
} from '../protocol.js';

describe('parseJsonRpcFrame', () => {
  test('rejects invalid JSON with a parse error and null id', () => {
    const parsed = parseJsonRpcFrame('{nope');
    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') {
      return;
    }
    expect(parsed.response.id).toBeNull();
    expect(parsed.response.error.code).toBe(JSON_RPC_PARSE_ERROR);
  });

  test('rejects an empty batch with one invalid request error', () => {
    const parsed = parseJsonRpcFrame('[]');
    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') {
      return;
    }
    expect(parsed.response.error.code).toBe(JSON_RPC_INVALID_REQUEST);
  });

  test('keeps the request id on shape failures when it is usable', () => {
    const parsed = parseJsonRpcFrame(
      JSON.stringify({ id: 7, jsonrpc: '1.0', method: 'greet' })
    );
    expect(parsed.kind).toBe('parsed');
    if (parsed.kind !== 'parsed') {
      return;
    }
    const [entry] = parsed.frame.requests;
    expect(entry?.kind).toBe('invalid');
    if (entry?.kind !== 'invalid') {
      return;
    }
    expect(entry.response.id).toBe(7);
    expect(entry.response.error.code).toBe(JSON_RPC_INVALID_REQUEST);
  });

  test('parses notifications without an id and batches entry by entry', () => {
    const parsed = parseJsonRpcFrame(
      JSON.stringify([
        { jsonrpc: '2.0', method: 'greet', params: { name: 'Ada' } },
        { id: 'a', jsonrpc: '2.0', method: 'trails.discover' },
        42,
      ])
    );
    expect(parsed.kind).toBe('parsed');
    if (parsed.kind !== 'parsed') {
      return;
    }
    expect(parsed.frame.batch).toBe(true);
    expect(parsed.frame.requests.map((entry) => entry.kind)).toEqual([
      'request',
      'request',
      'invalid',
    ]);
    const [first] = parsed.frame.requests;
    if (first?.kind !== 'request') {
      return;
    }
    expect('id' in first.request).toBe(false);
  });

  test('rejects params that are neither an object nor an array', () => {
    const parsed = parseJsonRpcFrame(
      JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'greet', params: 'x' })
    );
    expect(parsed.kind).toBe('parsed');
    if (parsed.kind !== 'parsed') {
      return;
    }
    expect(parsed.frame.requests[0]?.kind).toBe('invalid');
  });
});

describe('isReservedRpcMethod', () => {
  test('reserves the framework and JSON-RPC prefixes', () => {
    expect(isReservedRpcMethod('trails.discover')).toBe(true);
    expect(isReservedRpcMethod('rpc.ping')).toBe(true);
    expect(isReservedRpcMethod('trails')).toBe(false);
    expect(isReservedRpcMethod('gear.list')).toBe(false);
  });
});
