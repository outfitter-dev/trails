import { describe, expect, test } from 'bun:test';

import { contextNoSurfaceTypes } from '../rules/context-no-surface-types.js';
import { noDirectImplInRoute } from '../rules/no-direct-impl-in-route.js';
import { noThrowInImplementation } from '../rules/no-throw-in-implementation.js';
import { validDetourRefs } from '../rules/valid-detour-refs.js';

const TEST_FILE = 'test.ts';

// ---------------------------------------------------------------------------
// no-throw-in-implementation
// ---------------------------------------------------------------------------
describe('no-throw-in-implementation', () => {
  test('flags throw inside implementation body', () => {
    const code = `
trail("entity.show", {
  implementation: async (input, ctx) => {
    throw new Error("boom");
  }
})`;
    const diagnostics = noThrowInImplementation.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.rule).toBe('no-throw-in-implementation');
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('allows Result.err() in implementation', () => {
    const code = `
trail("entity.show", {
  implementation: async (input, ctx) => {
    return Result.err(new NotFoundError("not found"));
  }
})`;
    const diagnostics = noThrowInImplementation.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('does not flag throw outside implementation', () => {
    const code = `
function helper() {
  throw new Error("boom");
}

trail("entity.show", {
  implementation: async (input, ctx) => {
    return Result.ok(data);
  }
})`;
    const diagnostics = noThrowInImplementation.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// context-no-surface-types
// ---------------------------------------------------------------------------
describe('context-no-surface-types', () => {
  test('flags express import in trail file', () => {
    const code = `
import { Request, Response } from "express";
trail("entity.show", {
  implementation: async (input, ctx) => {
    return Result.ok(data);
  }
})`;
    const diagnostics = contextNoSurfaceTypes.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.rule).toBe('context-no-surface-types');
    expect(diagnostics[0]?.message).toContain('express');
  });

  test('flags McpSession import in trail file', () => {
    const code = `
import type { McpSession } from "@modelcontextprotocol/sdk";
trail("entity.show", {
  implementation: async (input, ctx) => {
    return Result.ok(data);
  }
})`;
    const diagnostics = contextNoSurfaceTypes.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
  });

  test('allows @ontrails/core imports in trail file', () => {
    const code = `
import { trail, Result } from "@ontrails/core";
trail("entity.show", {
  implementation: async (input, ctx) => {
    return Result.ok(data);
  }
})`;
    const diagnostics = contextNoSurfaceTypes.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('ignores files without trail() calls', () => {
    const code = `
import { Request, Response } from "express";
export function handleRequest(req: Request, res: Response) {}`;
    const diagnostics = contextNoSurfaceTypes.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// valid-detour-refs
// ---------------------------------------------------------------------------
describe('valid-detour-refs', () => {
  test('flags detour target that does not exist', () => {
    const code = `
trail("entity.show", {
  detours: [{ target: "entity.edit" }],
  implementation: async (input, ctx) => Result.ok(data)
})`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.edit');
  });

  test('passes when detour target exists', () => {
    const code = `
trail("entity.edit", {
  implementation: async (input, ctx) => Result.ok(data)
})

trail("entity.show", {
  detours: [{ target: "entity.edit" }],
  implementation: async (input, ctx) => Result.ok(data)
})`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('uses project context when available', () => {
    const code = `
trail("entity.show", {
  detours: [{ target: "entity.edit" }],
  implementation: async (input, ctx) => Result.ok(data)
})`;
    const context = { knownTrailIds: new Set(['entity.show', 'entity.edit']) };
    const diagnostics = validDetourRefs.checkWithContext(
      code,
      TEST_FILE,
      context
    );
    expect(diagnostics.length).toBe(0);
  });

  test('flags detour target in hike that does not exist', () => {
    const code = `
hike("entity.onboard", {
  detours: [{ target: "entity.missing" }],
  follows: ["entity.create"],
  implementation: async (input, ctx) => Result.ok(data)
})`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.missing');
  });

  test('passes when hike detour target exists', () => {
    const code = `
trail("entity.fallback", {
  implementation: async (input, ctx) => Result.ok(data)
})

hike("entity.onboard", {
  detours: [{ target: "entity.fallback" }],
  follows: ["entity.create"],
  implementation: async (input, ctx) => Result.ok(data)
})`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// no-direct-impl-in-route
// ---------------------------------------------------------------------------
describe('no-direct-impl-in-route', () => {
  test('warns on direct .implementation() call in route', () => {
    const code = `
hike("entity.onboard", {
  follows: ["entity.create"],
  implementation: async (input, ctx) => {
    const result = await entityCreate.implementation(data);
    return Result.ok(result);
  }
})`;
    const diagnostics = noDirectImplInRoute.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('ctx.follow');
  });

  test('allows ctx.follow() calls', () => {
    const code = `
hike("entity.onboard", {
  follows: ["entity.create"],
  implementation: async (input, ctx) => {
    const result = await ctx.follow("entity.create", data);
    return Result.ok(result);
  }
})`;
    const diagnostics = noDirectImplInRoute.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('ignores files without hike() calls', () => {
    const code = `
const result = await someTrail.implementation(data);`;
    const diagnostics = noDirectImplInRoute.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });
});
