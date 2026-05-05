import { describe, expect, test } from 'bun:test';

import { layerFieldNameDrift } from '../rules/layer-field-name-drift.js';

describe('layer-field-name-drift', () => {
  test('allows surfaces to consume the shared core reserved-name set', () => {
    const diagnostics = layerFieldNameDrift.check(
      `import { LAYER_FIELD_RESERVED_NAMES } from '@ontrails/core';

const collides = LAYER_FIELD_RESERVED_NAMES.has('all');
`,
      '/repo/packages/cli/src/build.ts'
    );

    expect(diagnostics).toEqual([]);
  });

  test('flags the legacy CLI-local meta flag set', () => {
    const diagnostics = layerFieldNameDrift.check(
      `const META_FLAG_CANDIDATES = new Set(['all', 'dryRun']);
`,
      '/repo/packages/cli/src/build.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('layer-field-name-drift');
    expect(diagnostics[0]?.message).toContain('META_FLAG_CANDIDATES');
  });

  test('flags surface-local layer reserved name arrays', () => {
    const diagnostics = layerFieldNameDrift.check(
      `const MCP_LAYER_RESERVED_NAMES = ['all', 'dryRun'];
`,
      '/repo/packages/mcp/src/build.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('layer-field-name-drift');
    expect(diagnostics[0]?.message).toContain('MCP_LAYER_RESERVED_NAMES');
  });

  test('ignores similarly named sets outside surface packages', () => {
    const diagnostics = layerFieldNameDrift.check(
      `const MCP_LAYER_RESERVED_NAMES = ['all', 'dryRun'];
`,
      '/repo/packages/warden/src/rules/example.ts'
    );

    expect(diagnostics).toEqual([]);
  });
});
