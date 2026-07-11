import { describe, expect, test } from 'bun:test';
import { Result, topo, trail } from '@ontrails/core';
import { testAll } from '@ontrails/testing';
import { z } from 'zod';

import { getEnvBinding } from '../../env.js';
import { cloudflareR2, createMemoryR2, r2ObjectToBlobRef } from '../index.js';
import type {
  CloudflareR2GetOptions,
  CloudflareR2ObjectBody,
} from '../index.js';

const expectBody = (
  object: Awaited<ReturnType<ReturnType<typeof createMemoryR2>['get']>>
): CloudflareR2ObjectBody => {
  expect(object).not.toBeNull();
  expect(object !== null && 'body' in object).toBe(true);
  return object as CloudflareR2ObjectBody;
};

describe('createMemoryR2', () => {
  test('keeps get conditions and ranges aligned with Workers R2', () => {
    const options = {
      onlyIf: { uploadedAfter: new Date(0) },
      range: { length: 10, offset: 0 },
    } satisfies CloudflareR2GetOptions;
    const invalidOptions: CloudflareR2GetOptions = {
      // @ts-expect-error R2 ranges use offset/length or suffix, not start/end.
      range: { end: 10, start: 0 },
    };

    expect(options.range).toEqual({ length: 10, offset: 0 });
    expect(invalidOptions.range).toEqual({ end: 10, start: 0 });
  });

  test('round-trips put/get/head/delete with metadata', async () => {
    const bucket = createMemoryR2();

    await bucket.put('notes.txt', 'hello', {
      customMetadata: { owner: 'trails' },
      httpMetadata: { contentLanguage: 'en', contentType: 'text/plain' },
      ssecKey: new ArrayBuffer(32),
    });

    const head = await bucket.head('notes.txt');
    expect(head).not.toBeNull();
    expect(head?.key).toBe('notes.txt');
    expect(head?.size).toBe(5);
    expect(head?.customMetadata).toEqual({ owner: 'trails' });
    expect('body' in (head ?? {})).toBe(false);

    const object = expectBody(
      await bucket.get('notes.txt', { ssecKey: '0'.repeat(64) })
    );
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('content-language')).toBe('en');
    expect(object.bodyUsed).toBe(false);
    expect(await object.text()).toBe('hello');
    expect(object.bodyUsed).toBe(true);

    const withoutSsecKey = expectBody(await bucket.get('notes.txt'));
    expect(await withoutSsecKey.text()).toBe('hello');
    expect(withoutSsecKey.ssecKeyMd5).toBeUndefined();

    await bucket.delete('notes.txt');
    expect(await bucket.head('notes.txt')).toBeNull();
    expect(await bucket.get('notes.txt')).toBeNull();
  });

  test('lists keys lexicographically with prefix, cursor, and multi-delete', async () => {
    const bucket = createMemoryR2();

    await bucket.put('assets/c.txt', 'c');
    await bucket.put('assets/a.txt', 'a');
    await bucket.put('docs/b.txt', 'b');

    const first = await bucket.list({ limit: 1, prefix: 'assets/' });
    expect(first.objects.map((object) => object.key)).toEqual(['assets/a.txt']);
    expect(first.truncated).toBe(true);
    expect(first.cursor).toBeDefined();

    const second = await bucket.list({
      cursor: first.cursor,
      limit: 1,
      prefix: 'assets/',
    });
    expect(second.objects.map((object) => object.key)).toEqual([
      'assets/c.txt',
    ]);
    expect(second.truncated).toBe(false);

    await bucket.delete(['assets/a.txt', 'assets/c.txt']);
    const emptyAssets = await bucket.list({ prefix: 'assets/' });
    const remaining = await bucket.list();
    expect(emptyAssets.objects).toEqual([]);
    expect(remaining.objects.map((object) => object.key)).toEqual([
      'docs/b.txt',
    ]);
  });

  test('rejects multi-delete batches above the R2 service limit', async () => {
    const bucket = createMemoryR2();
    const keys = Array.from({ length: 1001 }, (_, index) => `key-${index}`);

    await expect(bucket.delete(keys)).rejects.toThrow(
      'accept at most 1000 keys per call'
    );
  });

  test('paginates objects and prefixes that share the same key', async () => {
    const bucket = createMemoryR2();
    await bucket.put('foo', 'object');
    await bucket.put('foo/bar', 'nested');

    const first = await bucket.list({ delimiter: '/', limit: 1 });
    expect(first.objects.map((object) => object.key)).toEqual(['foo']);
    expect(first.delimitedPrefixes).toEqual([]);
    expect(first.truncated).toBe(true);
    expect(first.cursor).toBeDefined();

    const second = await bucket.list({
      cursor: first.cursor,
      delimiter: '/',
      limit: 1,
    });
    expect(second.objects).toEqual([]);
    expect(second.delimitedPrefixes).toEqual(['foo']);
    expect(second.truncated).toBe(false);
  });

  test('uses list ordering for key-only pagination boundaries', async () => {
    const bucket = createMemoryR2();
    await bucket.put('a', 'lowercase');
    await bucket.put('B', 'uppercase-b');
    await bucket.put('Z', 'uppercase-z');

    const ordered = await bucket.list();
    const startAfter = await bucket.list({ startAfter: 'B' });
    const legacyCursor = await bucket.list({ cursor: 'B' });

    expect(ordered.objects.map((object) => object.key)).toEqual([
      'B',
      'Z',
      'a',
    ]);
    expect(startAfter.objects.map((object) => object.key)).toEqual(['Z', 'a']);
    expect(legacyCursor.objects.map((object) => object.key)).toEqual([
      'Z',
      'a',
    ]);
  });

  test('does not confuse legacy keys with issued opaque cursor shapes', async () => {
    const bucket = createMemoryR2();
    const tupleKey = '["object","a"]';
    await bucket.put(tupleKey, 'tuple');
    await bucket.put('a', 'a');
    await bucket.put('z', 'z');

    const page = await bucket.list({ cursor: tupleKey });

    expect(page.objects.map((object) => object.key)).toEqual(['a', 'z']);
  });

  test('clamps requested list pages to the R2 service maximum', async () => {
    const bucket = createMemoryR2();
    await Promise.all(
      Array.from({ length: 1001 }, (_, index) =>
        bucket.put(`entry-${index.toString().padStart(4, '0')}`, 'value')
      )
    );

    const first = await bucket.list({ limit: 5000 });
    expect(first.objects).toHaveLength(1000);
    expect(first.truncated).toBe(true);
    expect(first.cursor).toBeDefined();

    const second = await bucket.list({ cursor: first.cursor, limit: 5000 });
    expect(second.objects).toHaveLength(1);
    expect(second.truncated).toBe(false);
  });

  test('returns list metadata only when requested through include', async () => {
    const bucket = createMemoryR2();
    await bucket.put('notes.txt', 'hello', {
      customMetadata: { owner: 'trails' },
      httpMetadata: { contentType: 'text/plain' },
    });

    const plainList = await bucket.list();
    const [plain] = plainList.objects;
    expect(plain?.customMetadata).toBeUndefined();
    expect(plain?.httpMetadata).toBeUndefined();

    const customList = await bucket.list({ include: ['customMetadata'] });
    const [custom] = customList.objects;
    expect(custom?.customMetadata).toEqual({ owner: 'trails' });
    expect(custom?.httpMetadata).toBeUndefined();

    const completeList = await bucket.list({
      include: ['customMetadata', 'httpMetadata'],
    });
    const [complete] = completeList.objects;
    expect(complete?.customMetadata).toEqual({ owner: 'trails' });
    expect(complete?.httpMetadata).toEqual({ contentType: 'text/plain' });
  });

  test('groups delimited prefixes when listing directory-shaped keys', async () => {
    const bucket = createMemoryR2();

    await bucket.put('foo/bar/baz.txt', 'nested');
    await bucket.put('foo/root.txt', 'root');
    await bucket.put('photos/1.jpg', 'photo');
    await bucket.put('readme.txt', 'readme');

    const root = await bucket.list({ delimiter: '/' });
    expect(root.delimitedPrefixes).toEqual(['foo', 'photos']);
    expect(root.objects.map((object) => object.key)).toEqual(['readme.txt']);

    const foo = await bucket.list({ delimiter: '/', prefix: 'foo/' });
    expect(foo.delimitedPrefixes).toEqual(['foo/bar']);
    expect(foo.objects.map((object) => object.key)).toEqual(['foo/root.txt']);
  });

  test('converts fetched objects into BlobRef values', async () => {
    const bucket = createMemoryR2();
    await bucket.put('image.svg', '<svg></svg>', {
      httpMetadata: { contentType: 'image/svg+xml' },
    });

    const object = expectBody(await bucket.get('image.svg'));
    const blob = r2ObjectToBlobRef(object);

    expect(blob.name).toBe('image.svg');
    expect(blob.mimeType).toBe('image/svg+xml');
    expect(blob.size).toBe(11);
    expect(blob.data).toBeInstanceOf(ReadableStream);
    expect(await new Response(blob.data).text()).toBe('<svg></svg>');
    expect(object.bodyUsed).toBe(true);
    await expect(object.text()).rejects.toThrow(
      'R2 object body has already been consumed'
    );
  });

  test('uses the returned range length for BlobRef size', async () => {
    const bucket = createMemoryR2();
    await bucket.put('readme.txt', 'hello', {
      httpMetadata: { contentType: 'text/plain' },
    });

    const object = expectBody(await bucket.get('readme.txt'));
    const rangedObject: CloudflareR2ObjectBody = {
      ...object,
      body: new Response('ell').body as ReadableStream<Uint8Array>,
      range: { length: 3, offset: 1 },
    };
    const blob = r2ObjectToBlobRef(rangedObject);

    expect(blob.size).toBe(3);
    expect(await new Response(blob.data).text()).toBe('ell');
  });

  test('keeps BlobRef streams single-use after the object body is consumed', async () => {
    const bucket = createMemoryR2();
    await bucket.put('readme.txt', 'hello', {
      httpMetadata: { contentType: 'text/plain' },
    });

    const object = expectBody(await bucket.get('readme.txt'));
    expect(await object.text()).toBe('hello');
    expect(object.bodyUsed).toBe(true);

    const blob = r2ObjectToBlobRef(object);
    await expect(new Response(blob.data).text()).rejects.toThrow(
      'R2 object body has already been consumed'
    );
  });
});

describe('cloudflareR2 resource', () => {
  test('declares binding metadata, env binding, and mock factory', async () => {
    const assets = cloudflareR2('assets', { binding: 'ASSETS' });
    const binding = getEnvBinding(assets);
    const bucket = createMemoryR2();

    const resolved = binding?.fromEnv(bucket);

    expect(assets.id).toBe('assets');
    expect(assets.meta?.['cloudflare.binding']).toBe('ASSETS');
    expect(assets.meta?.['cloudflare.service']).toBe('r2');
    expect(typeof assets.mock).toBe('function');
    expect(binding?.binding).toBe('ASSETS');
    expect(resolved?.isOk()).toBe(true);
    if (resolved?.isOk()) {
      await resolved.value.put('ok.txt', 'ok');
    }
    expect(await bucket.head('ok.txt')).not.toBeNull();
  });

  test('create refuses to run outside a Workers env with guidance', async () => {
    const assets = cloudflareR2('assets', { binding: 'ASSETS' });
    const created = await assets.create({
      config: undefined,
      cwd: '/',
      env: {},
      workspaceRoot: undefined,
    });

    expect(created.isErr()).toBe(true);
    if (created.isErr()) {
      expect(created.error.message).toContain('ASSETS');
      expect(created.error.message).toContain('createWorkersHandler');
    }
  });

  test('rejects a non-R2 env binding', () => {
    const assets = cloudflareR2('assets', { binding: 'ASSETS' });
    const result = getEnvBinding(assets)?.fromEnv('not-r2');

    expect(result?.isErr()).toBe(true);
    if (result?.isErr()) {
      expect(result.error.message).toContain('r2_buckets');
    }
  });
});

const assets = cloudflareR2('assets.test', { binding: 'ASSETS' });

const writeAsset = trail('asset.write', {
  examples: [
    {
      expected: { stored: true },
      input: {
        body: 'hello',
        contentType: 'text/plain',
        key: 'hello.txt',
      },
      name: 'stores an asset',
    },
  ],
  implementation: async (input, ctx) => {
    await assets.from(ctx).put(input.key, input.body, {
      httpMetadata: { contentType: input.contentType },
    });
    return Result.ok({ stored: true });
  },
  input: z.object({
    body: z.string(),
    contentType: z.string(),
    key: z.string(),
  }),
  intent: 'write',
  output: z.object({ stored: z.boolean() }),
  resources: [assets],
});

const statAsset = trail('asset.stat', {
  examples: [
    {
      expected: { size: null },
      input: { key: 'missing.txt' },
      name: 'missing asset',
    },
  ],
  implementation: async (input, ctx) => {
    const object = await assets.from(ctx).head(input.key);
    return Result.ok({ size: object?.size ?? null });
  },
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ size: z.number().nullable() }),
  resources: [assets],
});

testAll(topo('cf-r2', { assets, statAsset, writeAsset }));
