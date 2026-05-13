import { describe, expect, test } from 'bun:test';

import {
  collectPublicExportsFromSource,
  hasLeadingExampleForExport,
} from '../check-public-api-examples.ts';

describe('collectPublicExportsFromSource', () => {
  test('collects value re-exports and skips type-only exports', () => {
    const exports = collectPublicExportsFromSource(`
export { deriveThing, type ThingOptions } from './thing.js';
export type { OtherOptions } from './other.js';
export { createThing as makeThing } from './create.js';
`);

    expect(exports).toEqual([
      {
        exportName: 'deriveThing',
        importedName: 'deriveThing',
        moduleSpecifier: './thing.js',
      },
      {
        exportName: 'makeThing',
        importedName: 'createThing',
        moduleSpecifier: './create.js',
      },
    ]);
  });

  test('fails loudly for star re-exports instead of omitting them', () => {
    expect(() =>
      collectPublicExportsFromSource("export * from './thing.js';")
    ).toThrow(
      'Public API inventory does not support star re-exports from ./thing.js'
    );
  });
});

describe('hasLeadingExampleForExport', () => {
  test('detects an @example on the exported declaration', () => {
    expect(
      hasLeadingExampleForExport(
        `
/**
 * Build a thing.
 *
 * @example
 * const thing = buildThing();
 */
export const buildThing = () => ({});
`,
        'buildThing'
      )
    ).toBe(true);
  });

  test('does not treat file-level examples as declaration coverage', () => {
    expect(
      hasLeadingExampleForExport(
        `
/**
 * @example
 * const thing = buildThing();
 */

const helper = () => ({});

export const buildThing = helper;
`,
        'buildThing'
      )
    ).toBe(false);
  });

  test('detects @example when a line comment is closer to the export', () => {
    expect(
      hasLeadingExampleForExport(
        `
/**
 * Build a thing.
 *
 * @example
 * const thing = buildThing();
 */
// Public convenience helper.
export const buildThing = () => ({});
`,
        'buildThing'
      )
    ).toBe(true);
  });
});
