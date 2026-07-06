import { describe, expect, test } from 'bun:test';

import { noLegacyCliAliasExport } from '../rules/no-legacy-cli-alias-export.js';

const RULE_NAME = 'no-legacy-cli-alias-export';

describe('no-legacy-cli-alias-export', () => {
  test('flags `export const cliAliases` declarations', () => {
    const code = "export const cliAliases = { 'gear.ls': [['gear', 'ls']] };";

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe(RULE_NAME);
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.line).toBe(1);
    expect(diagnostics[0]?.message).toContain(
      "Legacy CLI alias export 'cliAliases'"
    );
    expect(diagnostics[0]?.message).toContain('TRL-1207');
    expect(diagnostics[0]?.message).toContain(
      'surfaceOverlay({ cli: { ... } })'
    );
    expect(diagnostics[0]?.message).toContain('trailsOverlays');
  });

  test('flags `export const trailsCliAliases` declarations', () => {
    const code = [
      'export const trailsCliAliases = {',
      "  'gear.ls': [['gear', 'ls']],",
      '};',
    ].join('\n');

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(1);
    expect(diagnostics[0]?.message).toContain(
      "Legacy CLI alias export 'trailsCliAliases'"
    );
  });

  test('flags `let`/`var` legacy exports', () => {
    const code = [
      'export let cliAliases = {};',
      'export var trailsCliAliases = {};',
    ].join('\n');

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    );

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.message).toContain("'cliAliases'");
    expect(diagnostics[1]?.line).toBe(2);
    expect(diagnostics[1]?.message).toContain("'trailsCliAliases'");
  });

  test('flags aliasing export specifiers', () => {
    const code = [
      'const whatever = {};',
      'export { whatever as trailsCliAliases };',
    ].join('\n');

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(2);
    expect(diagnostics[0]?.message).toContain(
      "Legacy CLI alias export 'trailsCliAliases'"
    );
  });

  test('flags named re-export statements', () => {
    const code = "export { trailsCliAliases } from './app.js';";

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/entry.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(1);
    expect(diagnostics[0]?.message).toContain(
      "Legacy CLI alias export 'trailsCliAliases'"
    );
  });

  test('carries review-required fix metadata naming the regrade class', () => {
    const code = 'export const cliAliases = {};';
    const fix = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    )[0]?.fix;

    expect(fix?.class).toBe('term-rewrite');
    // The rewrite is an export restructure with no mechanical single-span
    // replacement, so the fix is review-required and carries no edits.
    expect(fix?.safety).toBe('review');
    expect(fix?.edits).toBeUndefined();
    expect(fix?.reason).toContain('export-restructure');
    expect(fix?.reason).toContain('TRL-1210');
  });

  test('trailsOverlays surfaceOverlay app modules are clean', () => {
    const code = [
      "import { surfaceOverlay } from '@ontrails/core';",
      '',
      'export const trailsOverlays = [',
      "  surfaceOverlay({ cli: { ls: 'gear.list' } }),",
      '];',
    ].join('\n');

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('non-exported local `cliAliases` variables are legal', () => {
    const code = [
      "const cliAliases = { 'gear.ls': [['gear', 'ls']] };",
      'const bindings = Object.keys(cliAliases);',
      'export const size = bindings.length;',
    ].join('\n');

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('names appearing only in strings or comments are not flagged', () => {
    const code = [
      '// migration note: `trailsCliAliases` was removed in TRL-1207',
      "export const note = 'apps used to export cliAliases';",
    ].join('\n');

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('destructured legacy export bindings are flagged', () => {
    const code = "export const { cliAliases } = await import('./legacy.js');";

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      "Legacy CLI alias export 'cliAliases'"
    );
  });

  test('type-only exports of the legacy names are not flagged', () => {
    const code = [
      'type cliAliases = Record<string, readonly string[][]>;',
      'export type { cliAliases };',
    ].join('\n');

    const diagnostics = noLegacyCliAliasExport.check(
      code,
      '/repo/apps/example/src/app.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });
});
