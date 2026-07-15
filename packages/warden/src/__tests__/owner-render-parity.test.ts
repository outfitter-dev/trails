import { resolve } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { ownerRenderParity } from '../rules/owner-render-parity.js';

const TARGET_FILE = resolve(
  Bun.fileURLToPath(new URL('../../../http/src/method.ts', import.meta.url))
);
const UNRELATED_FILE = resolve(
  Bun.fileURLToPath(new URL('../../../http/src/other.ts', import.meta.url))
);

const buildSource = (
  body: string
): string => `import type { Intent } from '@ontrails/core';

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export const httpMethodByIntent = ${body} as const satisfies Record<Intent, HttpMethod>;
`;

describe('owner-render-parity', () => {
  test('ignores unrelated files', () => {
    const diagnostics = ownerRenderParity.check(
      buildSource("{ read: 'GET' }"),
      UNRELATED_FILE
    );

    expect(diagnostics).toEqual([]);
  });

  test('accepts HTTP method rendering covering owner intents', () => {
    const diagnostics = ownerRenderParity.check(
      buildSource("{ destroy: 'DELETE', read: 'GET', write: 'POST' }"),
      TARGET_FILE
    );

    expect(diagnostics).toEqual([]);
  });

  test('flags missing owner intent keys', () => {
    const diagnostics = ownerRenderParity.check(
      buildSource("{ read: 'GET', write: 'POST' }"),
      TARGET_FILE
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('missing owner intents: destroy');
  });

  test('flags unknown intent-map keys', () => {
    const diagnostics = ownerRenderParity.check(
      buildSource(
        "{ destroy: 'DELETE', read: 'GET', write: 'POST', archive: 'POST' }"
      ),
      TARGET_FILE
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      'unknown intentKeyMap keys: archive'
    );
  });

  test('live HTTP method rendering stays aligned with core intentValues', async () => {
    const source = await Bun.file(TARGET_FILE).text();
    const diagnostics = ownerRenderParity.check(source, TARGET_FILE);

    expect(diagnostics).toEqual([]);
  });
});
