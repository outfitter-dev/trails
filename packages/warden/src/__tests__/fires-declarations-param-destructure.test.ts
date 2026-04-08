import { describe, expect, test } from 'bun:test';

import { firesDeclarations } from '../rules/fires-declarations.js';

const TEST_FILE = 'test.ts';

describe('fires-declarations — parameter-level destructure', () => {
  test('parameter-level { fire } destructure is tracked (clean)', () => {
    const code = `
trail('paramDestructure', {
  fires: ['entity.created'],
  blaze: async (input, { fire }) => {
    await fire('entity.created', { name: input.name });
    return Result.ok({});
  },
});
`;

    const diagnostics = firesDeclarations.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('parameter-level { fire } destructure flags undeclared signal', () => {
    const code = `
trail('paramDestructureUndeclared', {
  blaze: async (input, { fire }) => {
    await fire('undeclared.signal', { name: input.name });
    return Result.ok({});
  },
});
`;

    const diagnostics = firesDeclarations.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.message).toContain("'undeclared.signal'");
  });

  test('parameter-level { fire: emit } rename is tracked', () => {
    const code = `
trail('paramRename', {
  blaze: async (input, { fire: emit }) => {
    await emit('undeclared.renamed', { name: input.name });
    return Result.ok({});
  },
});
`;

    const diagnostics = firesDeclarations.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.message).toContain("'undeclared.renamed'");
  });
});
