import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { adapterSourceExportKind, adapterSourceExports } from '../source.js';

const roots: string[] = [];

const writeFile = (root: string, path: string, value: string): void => {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
};

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'trails-adapter-source-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('adapter source export scanning', () => {
  test('classifies direct source exports by type and value position', () => {
    const root = makeRoot();
    writeFile(
      root,
      'src/index.ts',
      [
        'export interface AdapterOptions {}',
        'export const createAdapter = () => undefined;',
        'export class AdapterRuntime {}',
        '',
      ].join('\n')
    );
    const sourcePath = join(root, 'src/index.ts');

    expect(adapterSourceExportKind(sourcePath, 'AdapterOptions')).toBe('type');
    expect(adapterSourceExportKind(sourcePath, 'createAdapter')).toBe('value');
    expect(adapterSourceExportKind(sourcePath, 'AdapterRuntime')).toBe(
      'type-value'
    );
    expect(adapterSourceExports(sourcePath, 'AdapterRuntime', 'type')).toBe(
      true
    );
    expect(adapterSourceExports(sourcePath, 'AdapterRuntime', 'value')).toBe(
      true
    );
    expect(adapterSourceExports(sourcePath, 'createAdapter', 'type')).toBe(
      false
    );
  });

  test('preserves shared type and value names through type-only barrels', () => {
    const root = makeRoot();
    writeFile(
      root,
      'src/fetch.ts',
      [
        'export interface CreateFetchHandlerOptions { enabled: boolean }',
        'export const CreateFetchHandlerOptions = { enabled: true };',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'src/index.ts',
      ['export type { CreateFetchHandlerOptions } from "./fetch.js";', ''].join(
        '\n'
      )
    );

    expect(
      adapterSourceExportKind(
        join(root, 'src/fetch.ts'),
        'CreateFetchHandlerOptions'
      )
    ).toBe('interface-value');
    expect(
      adapterSourceExports(
        join(root, 'src/index.ts'),
        'CreateFetchHandlerOptions',
        'type'
      )
    ).toBe(true);
    expect(
      adapterSourceExports(
        join(root, 'src/index.ts'),
        'CreateFetchHandlerOptions',
        'value'
      )
    ).toBe(false);
  });

  test('preserves shared type-alias and value names through type-only barrels', () => {
    const root = makeRoot();
    writeFile(
      root,
      'src/fetch.ts',
      [
        'export type CreateFetchHandlerOptions = { enabled?: boolean };',
        'export const CreateFetchHandlerOptions = { enabled: true };',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'src/index.ts',
      ['export type { CreateFetchHandlerOptions } from "./fetch.js";', ''].join(
        '\n'
      )
    );

    expect(
      adapterSourceExportKind(
        join(root, 'src/fetch.ts'),
        'CreateFetchHandlerOptions'
      )
    ).toBe('type-alias-value');
    expect(
      adapterSourceExportKind(
        join(root, 'src/index.ts'),
        'CreateFetchHandlerOptions'
      )
    ).toBe('type-alias-value-erased');
  });

  test('combines direct type and re-exported value evidence', () => {
    const root = makeRoot();
    writeFile(
      root,
      'src/fetch.ts',
      'export const createFetchHandler = () => undefined;\n'
    );
    writeFile(
      root,
      'src/index.ts',
      [
        'export type createFetchHandler = () => unknown;',
        'export { createFetchHandler } from "./fetch.js";',
        '',
      ].join('\n')
    );
    const sourcePath = join(root, 'src/index.ts');

    expect(adapterSourceExportKind(sourcePath, 'createFetchHandler')).toBe(
      'type-value'
    );
    expect(
      adapterSourceExports(sourcePath, 'createFetchHandler', 'value')
    ).toBe(true);
  });

  test('follows same-file export lists backed by local imports', () => {
    const root = makeRoot();
    writeFile(
      root,
      'src/fetch.ts',
      [
        'export interface CreateFetchHandlerOptions {}',
        'export const createFetchHandler = () => undefined;',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'src/index.ts',
      [
        'import { createFetchHandler } from "./fetch.js";',
        'import type { CreateFetchHandlerOptions } from "./fetch.js";',
        'export { createFetchHandler, type CreateFetchHandlerOptions };',
        '',
      ].join('\n')
    );
    const sourcePath = join(root, 'src/index.ts');

    expect(
      adapterSourceExports(sourcePath, 'createFetchHandler', 'value')
    ).toBe(true);
    expect(
      adapterSourceExports(sourcePath, 'CreateFetchHandlerOptions', 'type')
    ).toBe(true);
    expect(adapterSourceExports(sourcePath, 'createFetchHandler', 'type')).toBe(
      false
    );
  });

  test('preserves erased type-value provenance through type-only barrels', () => {
    const root = makeRoot();
    writeFile(
      root,
      'src/fetch.ts',
      [
        'export enum CreateFetchHandlerOptions { Default }',
        'export class CreateFetchHandlerClass {}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'src/index.ts',
      [
        'import type { CreateFetchHandlerClass, CreateFetchHandlerOptions } from "./fetch.js";',
        'export type { CreateFetchHandlerClass, CreateFetchHandlerOptions };',
        '',
      ].join('\n')
    );
    const sourcePath = join(root, 'src/index.ts');

    expect(
      adapterSourceExportKind(sourcePath, 'CreateFetchHandlerOptions')
    ).toBe('type-value-erased');
    expect(adapterSourceExportKind(sourcePath, 'CreateFetchHandlerClass')).toBe(
      'type-value-erased'
    );
    expect(
      adapterSourceExports(sourcePath, 'CreateFetchHandlerOptions', 'type')
    ).toBe(true);
    expect(
      adapterSourceExports(sourcePath, 'CreateFetchHandlerOptions', 'value')
    ).toBe(false);
  });

  test('does not treat declare-only same-file export lists as values', () => {
    const root = makeRoot();
    writeFile(
      root,
      'src/index.ts',
      [
        'declare const createFetchHandler: () => unknown;',
        'export interface CreateFetchHandlerOptions {}',
        'export { createFetchHandler };',
        '',
      ].join('\n')
    );
    const sourcePath = join(root, 'src/index.ts');

    expect(
      adapterSourceExports(sourcePath, 'createFetchHandler', 'value')
    ).toBe(false);
    expect(
      adapterSourceExports(sourcePath, 'CreateFetchHandlerOptions', 'type')
    ).toBe(true);
  });

  test('follows named and star re-exports while preserving type-only erasure', () => {
    const root = makeRoot();
    writeFile(
      root,
      'src/fetch.ts',
      [
        'export interface CreateFetchHandlerOptions {}',
        'export const createFetchHandler = () => undefined;',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'src/barrel.ts',
      [
        'export { createFetchHandler as aliasedFetch } from "./fetch.js";',
        'export type { CreateFetchHandlerOptions } from "./fetch.js";',
        'export type { createFetchHandler as erasedFetch } from "./fetch.js";',
        '',
      ].join('\n')
    );
    writeFile(root, 'src/index.ts', 'export * from "./barrel.js";\n');
    const sourcePath = join(root, 'src/index.ts');

    expect(adapterSourceExports(sourcePath, 'aliasedFetch', 'value')).toBe(
      true
    );
    expect(
      adapterSourceExports(sourcePath, 'CreateFetchHandlerOptions', 'type')
    ).toBe(true);
    expect(adapterSourceExports(sourcePath, 'erasedFetch', 'value')).toBe(
      false
    );
  });

  test('gives explicit exports precedence over same-name star exports', () => {
    const root = makeRoot();
    writeFile(root, 'src/value.ts', 'export const Subject = true;\n');
    writeFile(root, 'src/types.ts', 'export interface Subject {}\n');
    writeFile(
      root,
      'src/index.ts',
      [
        'export { Subject } from "./value.js";',
        'export * from "./types.js";',
        '',
      ].join('\n')
    );

    expect(adapterSourceExportKind(join(root, 'src/index.ts'), 'Subject')).toBe(
      'value'
    );
  });

  test('ignores comments and strings while resolving local mts targets', () => {
    const root = makeRoot();
    writeFile(
      root,
      'src/index.ts',
      [
        '// export const Ghost = true;',
        'const docs = "export const Phantom = true";',
        'export { actual } from "./runtime.mjs";',
        '',
      ].join('\n')
    );
    writeFile(root, 'src/runtime.mts', 'export const actual = true;\n');
    const sourcePath = join(root, 'src/index.ts');

    expect(adapterSourceExports(sourcePath, 'Ghost', 'value')).toBe(false);
    expect(adapterSourceExports(sourcePath, 'Phantom', 'value')).toBe(false);
    expect(adapterSourceExports(sourcePath, 'actual', 'value')).toBe(true);
  });

  test('returns no export kind for unreadable source paths', () => {
    const root = makeRoot();
    const sourcePath = join(root, 'src/missing.ts');

    expect(adapterSourceExportKind(sourcePath, 'missing')).toBeUndefined();
    expect(adapterSourceExports(sourcePath, 'missing', 'value')).toBe(false);
  });
});
