import { expect, test } from 'bun:test';
import {
  getNodeCallee,
  getNodeOptional,
  getNodeStatic,
  getNodeTypeArguments,
  getNodeTypeName,
  identifierName,
  parse,
  walk,
} from '../index.js';

test('generic accessors preserve explicit class and qualified Result type nodes', () => {
  const ast = parse(
    'generic.ts',
    'const store = resource<Client>("store", {}); class Client { static read(): Promise<Trails.Result<string, Error>> {} }'
  );
  const seen: string[] = [];
  walk(ast, (node) => {
    if (
      node.type === 'CallExpression' &&
      identifierName(getNodeCallee(node)) === 'resource'
    ) {
      const args = getNodeTypeArguments(node);
      expect(args).toHaveLength(1);
      expect(identifierName(getNodeTypeName(args[0]))).toBe('Client');
    }
    if (node.type === 'TSTypeReference') {
      seen.push(getNodeTypeName(node)?.type ?? '');
    }
    if (node.type === 'MethodDefinition') {
      expect(getNodeStatic(node)).toBe(true);
    }
  });
  expect(seen).toContain('TSQualifiedName');
  expect(getNodeTypeArguments()).toEqual([]);
  expect(getNodeTypeName()).toBeUndefined();
  expect(getNodeStatic()).toBe(false);
});

test('optional call/member flags are distinct from ordinary static access', () => {
  const ast = parse(
    'optional.ts',
    'client?.read(); client.read?.(); client.read();'
  );
  const calls: boolean[] = [];
  walk(ast, (node) => {
    if (node.type === 'CallExpression') {
      calls.push(getNodeOptional(node) || getNodeOptional(getNodeCallee(node)));
    }
  });
  expect(calls).toEqual([true, true, false]);
  expect(getNodeOptional()).toBe(false);
});
