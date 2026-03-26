import { describe, test, expect } from 'bun:test';

import { createBlobRef, isBlobRef } from '../blob-ref';

describe('BlobRef', () => {
  const sampleData = new Uint8Array([137, 80, 78, 71]);

  describe('createBlobRef', () => {
    test('returns a frozen object with the provided fields', () => {
      const ref = createBlobRef({
        data: sampleData,
        mimeType: 'image/png',
        name: 'image.png',
        size: 4,
      });

      expect(ref.name).toBe('image.png');
      expect(ref.mimeType).toBe('image/png');
      expect(ref.size).toBe(4);
      expect(ref.data).toBe(sampleData);
      expect(Object.isFrozen(ref)).toBe(true);
    });

    test('works with ReadableStream data', () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(sampleData);
          controller.close();
        },
      });

      const ref = createBlobRef({
        data: stream,
        mimeType: 'video/mp4',
        name: 'video.mp4',
        size: 1024,
      });

      expect(ref.data).toBeInstanceOf(ReadableStream);
    });
  });

  describe('isBlobRef', () => {
    test('returns true for a valid BlobRef with Uint8Array data', () => {
      const ref = createBlobRef({
        data: sampleData,
        mimeType: 'application/octet-stream',
        name: 'file.bin',
        size: 4,
      });

      expect(isBlobRef(ref)).toBe(true);
    });

    test('returns true for a valid BlobRef with ReadableStream data', () => {
      const stream = new ReadableStream<Uint8Array>();
      const ref = createBlobRef({
        data: stream,
        mimeType: 'application/octet-stream',
        name: 'file.bin',
        size: 0,
      });

      expect(isBlobRef(ref)).toBe(true);
    });

    test('returns true for a plain object matching the shape', () => {
      expect(
        isBlobRef({
          data: new Uint8Array(),
          mimeType: 'application/pdf',
          name: 'doc.pdf',
          size: 999,
        })
      ).toBe(true);
    });

    test('returns false for null', () => {
      expect(isBlobRef(null)).toBe(false);
    });

    test('returns false for a string', () => {
      expect(isBlobRef('not a blob')).toBe(false);
    });

    test('returns false when name is missing', () => {
      expect(
        isBlobRef({ data: new Uint8Array(), mimeType: 'text/plain', size: 0 })
      ).toBe(false);
    });

    test('returns false when data is a plain object', () => {
      expect(
        isBlobRef({
          data: {},
          mimeType: 'text/plain',
          name: 'x',
          size: 0,
        })
      ).toBe(false);
    });
  });
});
