import { describe, expect, test } from 'bun:test';

import { firesDeclarations } from '../rules/fires-declarations.js';

const TEST_FILE = 'test.ts';

describe('fires-declarations — parameter-level destructure', () => {
  test('parameter-level { fire } destructure is tracked (clean)', () => {
    const code = `
const entityCreated = signal('entity.created', { payload: z.object({}) });
trail('paramDestructure', {
  fires: [entityCreated],
  blaze: async (input, { fire }) => {
    await fire(entityCreated, { name: input.name });
    return Result.ok({});
  },
});
`;

    const diagnostics = firesDeclarations.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('parameter-level { fire } destructure flags undeclared signal', () => {
    const code = `
const undeclaredSignal = signal('undeclared.signal', { payload: z.object({}) });
trail('paramDestructureUndeclared', {
  blaze: async (input, { fire }) => {
    await fire(undeclaredSignal, { name: input.name });
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
const undeclaredRenamed = signal('undeclared.renamed', { payload: z.object({}) });
trail('paramRename', {
  blaze: async (input, { fire: emit }) => {
    await emit(undeclaredRenamed, { name: input.name });
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
