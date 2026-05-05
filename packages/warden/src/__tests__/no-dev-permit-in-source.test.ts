import { describe, expect, test } from 'bun:test';

import { noDevPermitInSource } from '../rules/no-dev-permit-in-source.js';

const RULE_NAME = 'no-dev-permit-in-source';
const DEV_PERMIT_FLAG = ['--dev', '-permit'].join('');

const buildScriptCode = (): string =>
  [
    "import { spawn } from 'node:child_process';",
    '',
    `const proc = spawn("trails", ["thing.write", "${DEV_PERMIT_FLAG}", "--id", "abc"]);`,
    'await proc.exited;',
  ].join('\n');

describe('no-dev-permit-in-source', () => {
  test('flags dev permit flag strings in committed source', () => {
    const code = buildScriptCode();

    const diagnostics = noDevPermitInSource.check(
      code,
      '/repo/apps/example/scripts/seed.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe(RULE_NAME);
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.line).toBe(3);
    expect(diagnostics[0]?.message).toContain('committed source');
  });

  test('flags occurrences inside template strings', () => {
    const code = [`const cmd = \`trails run ${DEV_PERMIT_FLAG}\`;`].join('\n');

    const diagnostics = noDevPermitInSource.check(
      code,
      '/repo/packages/example/src/runner.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe(RULE_NAME);
  });

  test('clean source files produce no diagnostics', () => {
    const code = [
      "import { tokenPreset } from '@ontrails/cli';",
      '',
      'export const presets = [tokenPreset()];',
    ].join('\n');

    const diagnostics = noDevPermitInSource.check(
      code,
      '/repo/apps/example/src/cli.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on the CLI flag preset module that authors the literal', () => {
    const code = [
      "export const devPermitPreset = () => [{ name: 'dev-permit' }];",
      `// Documents the canonical CLI form: ${DEV_PERMIT_FLAG}`,
    ].join('\n');

    const diagnostics = noDevPermitInSource.check(
      code,
      '/repo/packages/cli/src/flags.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on the CLI build module that wires the flag', () => {
    const code = [
      `const conflicts: string[] = ['${DEV_PERMIT_FLAG}'];`,
      'export {};',
    ].join('\n');

    const diagnostics = noDevPermitInSource.check(
      code,
      '/repo/packages/cli/src/build.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on the rule implementation file itself', () => {
    const code = [
      `// implementation detail mentioning ${DEV_PERMIT_FLAG}`,
    ].join('\n');

    const diagnostics = noDevPermitInSource.check(
      code,
      '/repo/packages/warden/src/rules/no-dev-permit-in-source.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('does not fire on the rule metadata or trail wrapper', () => {
    const code = [
      `export const description = "Flags ${DEV_PERMIT_FLAG} in committed source";`,
    ].join('\n');

    const metadataDiagnostics = noDevPermitInSource.check(
      code,
      '/repo/packages/warden/src/rules/metadata.ts'
    );
    const trailDiagnostics = noDevPermitInSource.check(
      code,
      '/repo/packages/warden/src/trails/no-dev-permit-in-source.trail.ts'
    );

    expect(metadataDiagnostics).toHaveLength(0);
    expect(trailDiagnostics).toHaveLength(0);
  });

  test('similar typos are also flagged (substring match is conservative)', () => {
    const code = [
      `const flag = "${DEV_PERMIT_FLAG}s";`,
      'const other = "--devpermit";',
    ].join('\n');

    const diagnostics = noDevPermitInSource.check(
      code,
      '/repo/apps/example/src/runner.ts'
    );

    // A pluralized typo still contains the canonical flag text, so the rule
    // WILL match there. This documents the intentional behavior: a substring
    // match is the conservative choice.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(1);
  });
});
