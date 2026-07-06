import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { sha256Hex } from '../sha256.js';

describe('sha256Hex', () => {
  test('matches FIPS 180-4 known-answer vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  test('is output-identical to node:crypto across padding boundaries', () => {
    // Lengths 0..129 cross both the 56-byte and 64-byte block boundaries
    // where padding bugs hide; the unicode suffix exercises multi-byte
    // UTF-8 encoding.
    for (let length = 0; length <= 129; length += 1) {
      const text = `${'x'.repeat(length)}${length % 3 === 0 ? '✨日本語' : ''}`;
      expect(sha256Hex(text)).toBe(
        createHash('sha256').update(text).digest('hex')
      );
    }
  });
});
