import { describe, expect, test } from 'bun:test';

import { noLegacyLayerImports } from '../rules/no-legacy-layer-imports.js';

const RULE_NAME = 'no-legacy-layer-imports';

describe('no-legacy-layer-imports', () => {
  test('flags `authLayer` references in committed source', () => {
    const code = [
      "import { authLayer } from '@ontrails/permits';",
      '',
      'export const layers = [authLayer()];',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/apps/example/src/cli.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe(RULE_NAME);
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.line).toBe(1);
    expect(diagnostics[0]?.message).toContain("Legacy layer 'authLayer'");
    expect(diagnostics[0]?.message).toContain('TRL-475');
    expect(diagnostics[0]?.message).toContain(
      'docs/adr/0043-layer-evolution.md'
    );
  });

  test('carries review-required term-rewrite fix metadata (TRL-832)', () => {
    const code = "import { authLayer } from '@ontrails/permits';";
    const fix = noLegacyLayerImports.check(
      code,
      '/repo/apps/example/src/cli.ts'
    )[0]?.fix;

    expect(fix?.class).toBe('term-rewrite');
    // These legacy layers were removed, not renamed: no mechanical replacement,
    // so the fix is review-required and carries no edits. `warden --fix` must
    // never auto-apply it; it stays reported for human migration.
    expect(fix?.safety).toBe('review');
    expect(fix?.edits).toBeUndefined();
    expect(fix?.reason).toContain('authLayer');
  });

  test('flags `autoIterateLayer` references in committed source', () => {
    const code = [
      "import { autoIterateLayer } from '@ontrails/cli';",
      '',
      'export const layers = [autoIterateLayer()];',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/apps/example/src/runner.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      "Legacy layer 'autoIterateLayer'"
    );
    expect(diagnostics[0]?.message).toContain('TRL-476');
    expect(diagnostics[0]?.message).toContain('TRL-469');
  });

  test('flags `dateShortcutsLayer` references in committed source', () => {
    const code = [
      "import { dateShortcutsLayer } from '@ontrails/cli';",
      '',
      'export const layers = [dateShortcutsLayer()];',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/apps/example/src/runner.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      "Legacy layer 'dateShortcutsLayer'"
    );
    expect(diagnostics[0]?.message).toContain('TRL-476');
    expect(diagnostics[0]?.message).toContain('TRL-470');
  });

  test('reports the earliest legacy reference when multiple appear', () => {
    const code = [
      '// migration note',
      "import { autoIterateLayer } from '@ontrails/cli';",
      "import { authLayer } from '@ontrails/permits';",
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/apps/example/src/runner.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(2);
    expect(diagnostics[0]?.message).toContain(
      "Legacy layer 'autoIterateLayer'"
    );
  });

  test('clean source files produce no diagnostics', () => {
    const code = [
      "import { tokenPreset } from '@ontrails/cli';",
      '',
      'export const presets = [tokenPreset()];',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/apps/example/src/cli.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not flag legacy names embedded in longer identifiers', () => {
    const code = [
      'type authLayerConfig = { enabled: boolean };',
      'const withoutauthLayer = true;',
      'const legacy_authLayer = true;',
      'const autoIterateLayerShim = () => undefined;',
      'const dateShortcutsLayer$adapter = () => undefined;',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/apps/example/src/runner.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on the CLI pagination module migration note', () => {
    const code = [
      '/** Earlier betas exposed an `autoIterateLayer` that ... */',
      'export const paginate = () => undefined;',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/packages/cli/src/pagination.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on the CLI date-shortcuts module migration note', () => {
    const code = [
      '/** Earlier betas exposed a `dateShortcutsLayer` ... */',
      'export const expand = () => undefined;',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/packages/cli/src/date-shortcuts.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on the rule implementation file itself', () => {
    const code = [
      '// implementation references authLayer / autoIterateLayer / dateShortcutsLayer',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/packages/warden/src/rules/no-legacy-layer-imports.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on Warden rule metadata', () => {
    const code = [
      "'no-legacy-layer-imports': {",
      "  invariant: 'authLayer / autoIterateLayer / dateShortcutsLayer stay removed',",
      '},',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/packages/warden/src/rules/metadata.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on its rule trail examples', () => {
    const code = [
      'message: "Legacy layer \'authLayer\' was removed in TRL-475."',
      "sourceCode: `import { authLayer } from '@ontrails/permits';\\n`,",
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/packages/warden/src/trails/no-legacy-layer-imports.trail.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('flags references inside string literals and JSDoc', () => {
    const code = [
      '/** TODO: replace authLayer wiring */',
      'export const note = "uses authLayer";',
    ].join('\n');

    const diagnostics = noLegacyLayerImports.check(
      code,
      '/repo/apps/example/src/runner.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(1);
  });
});
