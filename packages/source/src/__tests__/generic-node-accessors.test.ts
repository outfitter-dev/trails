import { expect, test } from 'bun:test';
import {
  collectPatternBindingNames,
  getNodeCallee,
  getNodeIntersectionTypes,
  getNodeOptional,
  getNodeLeft,
  getNodeStatic,
  getNodeTypeArguments,
  getNodeTypeName,
  getNodeTypeParameterNames,
  identifierName,
  parse,
  walk,
} from '../index.js';

test('returns declared type parameter names without looking at constraints', () => {
  const ast = parse(
    'parameters.ts',
    'class Client<T> { read<Result extends T, Value = Result>() {} }'
  );
  const names: (readonly string[])[] = [];
  walk(ast, (node) => {
    if (
      node.type === 'ClassDeclaration' ||
      node.type === 'FunctionExpression'
    ) {
      names.push(getNodeTypeParameterNames(node));
    }
  });
  expect(names).toEqual([['T'], ['Result', 'Value']]);
  expect(getNodeTypeParameterNames()).toEqual([]);
});

test('collects assignment binding targets without counting member names or defaults', () => {
  const ast = parse(
    'pattern.ts',
    '({ key: [, target = use(defaultValue), object.member], ...rest } = input);'
  );
  walk(ast, (node) => {
    if (node.type === 'AssignmentExpression') {
      expect(collectPatternBindingNames(getNodeLeft(node))).toEqual(
        new Set(['target', 'rest'])
      );
    }
  });
});

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

test('intersection accessor exposes direct members but not union alternatives', () => {
  const ast = parse(
    'types.ts',
    'type A = Result & Meta; type B = Result | Raw;'
  );
  const members: (readonly string[])[] = [];
  walk(ast, (node) => {
    if (node.type === 'TSIntersectionType' || node.type === 'TSUnionType') {
      members.push(
        getNodeIntersectionTypes(node).map(
          (type) => identifierName(getNodeTypeName(type)) ?? ''
        )
      );
    }
  });
  expect(members).toEqual([['Result', 'Meta'], []]);
});
