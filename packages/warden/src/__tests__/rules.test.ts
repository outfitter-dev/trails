import { describe, expect, test } from 'bun:test';

import { contextNoSurfaceTypes } from '../rules/context-no-surface-types.js';
import { eventOriginsExist } from '../rules/event-origins-exist.js';
import { followsMatchesCalls } from '../rules/follows-matches-calls.js';
import { followsTrailsExist } from '../rules/follows-trails-exist.js';
import { noDirectImplInRoute } from '../rules/no-direct-impl-in-route.js';
import { noRecursiveFollows } from '../rules/no-recursive-follows.js';
import { noThrowInImplementation } from '../rules/no-throw-in-implementation.js';
import { requireOutputSchema } from '../rules/require-output-schema.js';
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
// require-output-schema
// ---------------------------------------------------------------------------
describe('require-output-schema', () => {
  test('warns on MCP trail without output schema', () => {
    const code = `
trail("entity.show", {
  surfaces: ["mcp", "cli"],
  input: z.object({ id: z.string() }),
  implementation: async (input, ctx) => {
    return Result.ok(data);
  }
})`;
    const diagnostics = requireOutputSchema.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('entity.show');
  });

  test('allows CLI-only trail without output schema', () => {
    const code = `
trail("entity.show", {
  surfaces: ["cli"],
  input: z.object({ id: z.string() }),
  implementation: async (input, ctx) => {
    return Result.ok(data);
  }
})`;
    const diagnostics = requireOutputSchema.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('allows MCP trail with output schema', () => {
    const code = `
trail("entity.show", {
  surfaces: ["mcp"],
  input: z.object({ id: z.string() }),
  output: z.object({ name: z.string() }),
  implementation: async (input, ctx) => {
    return Result.ok(data);
  }
})`;
    const diagnostics = requireOutputSchema.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// follows-matches-calls
// ---------------------------------------------------------------------------
describe('follows-matches-calls', () => {
  test('errors when ctx.follow() call is not declared', () => {
    const code = `
hike("entity.onboard", {
  follows: ["entity.create"],
  implementation: async (input, ctx) => {
    await ctx.follow("entity.create", data);
    await ctx.follow("entity.notify", data);
  }
})`;
    const diagnostics = followsMatchesCalls.check(code, TEST_FILE);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBe(1);
    expect(errors[0]?.message).toContain('entity.notify');
  });

  test('warns when declared follow is unused', () => {
    const code = `
hike("entity.onboard", {
  follows: ["entity.create", "entity.notify"],
  implementation: async (input, ctx) => {
    await ctx.follow("entity.create", data);
  }
})`;
    const diagnostics = followsMatchesCalls.check(code, TEST_FILE);
    const warnings = diagnostics.filter((d) => d.severity === 'warn');
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.message).toContain('entity.notify');
  });

  test('passes when all declarations match calls', () => {
    const code = `
hike("entity.onboard", {
  follows: ["entity.create", "entity.notify"],
  implementation: async (input, ctx) => {
    await ctx.follow("entity.create", data);
    await ctx.follow("entity.notify", data);
  }
})`;
    const diagnostics = followsMatchesCalls.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('handles generic ctx.follow<T>() calls', () => {
    const code = `
hike("entity.onboard", {
  follows: ["entity.create"],
  implementation: async (input, ctx) => {
    const result = await ctx.follow<{ id: string }>("entity.create", data);
    return result;
  }
})`;
    const diagnostics = followsMatchesCalls.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('counts helper follow calls when helper is invoked with ctx.follow', () => {
    const code = `
const addSurfaceFiles = async (follow, data) => {
  await follow("entity.create", data);
};

hike("entity.onboard", {
  follows: ["entity.create"],
  implementation: async (input, ctx) => {
    await addSurfaceFiles(ctx.follow, input);
  }
})`;
    const diagnostics = followsMatchesCalls.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// no-recursive-follows
// ---------------------------------------------------------------------------
describe('no-recursive-follows', () => {
  test('flags self-referential follows', () => {
    const code = `
hike("entity.loop", {
  follows: ["entity.loop"],
  implementation: async (input, ctx) => {
    await ctx.follow("entity.loop", data);
  }
})`;
    const diagnostics = noRecursiveFollows.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.loop');
    expect(diagnostics[0]?.message).toContain('references itself');
  });

  test('allows non-cyclic follows', () => {
    const code = `
hike("entity.onboard", {
  follows: ["entity.create", "entity.notify"],
  implementation: async (input, ctx) => {
    await ctx.follow("entity.create", data);
  }
})`;
    const diagnostics = noRecursiveFollows.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// follows-trails-exist
// ---------------------------------------------------------------------------
describe('follows-trails-exist', () => {
  test('flags follows ID that does not exist (single file)', () => {
    const code = `
trail("entity.create", {
  implementation: async (input, ctx) => Result.ok(data)
})

hike("entity.onboard", {
  follows: ["entity.create", "entity.missing"],
  implementation: async (input, ctx) => {
    await ctx.follow("entity.create", data);
  }
})`;
    const diagnostics = followsTrailsExist.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.missing');
  });

  test('passes when all follows IDs exist (single file)', () => {
    const code = `
trail("entity.create", {
  implementation: async (input, ctx) => Result.ok(data)
})

hike("entity.onboard", {
  follows: ["entity.create"],
  implementation: async (input, ctx) => {
    await ctx.follow("entity.create", data);
  }
})`;
    const diagnostics = followsTrailsExist.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('uses project context when available', () => {
    const code = `
hike("entity.onboard", {
  follows: ["entity.create", "entity.missing"],
  implementation: async (input, ctx) => {
    await ctx.follow("entity.create", data);
  }
})`;
    const context = {
      knownTrailIds: new Set(['entity.create', 'entity.onboard']),
    };
    const diagnostics = followsTrailsExist.checkWithContext(
      code,
      TEST_FILE,
      context
    );
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.missing');
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

// ---------------------------------------------------------------------------
// event-origins-exist
// ---------------------------------------------------------------------------
describe('event-origins-exist', () => {
  test('flags from ID that does not exist (single file)', () => {
    const code = `
trail("entity.add", {
  implementation: async (input, ctx) => Result.ok(data)
})

event("entity.updated", {
  payload: z.object({ id: z.string() }),
  from: ["entity.add", "entity.missing"],
})`;
    const diagnostics = eventOriginsExist.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.missing');
  });

  test('passes when all from IDs exist (single file)', () => {
    const code = `
trail("entity.add", {
  implementation: async (input, ctx) => Result.ok(data)
})

trail("entity.delete", {
  implementation: async (input, ctx) => Result.ok(data)
})

event("entity.updated", {
  payload: z.object({ id: z.string() }),
  from: ["entity.add", "entity.delete"],
})`;
    const diagnostics = eventOriginsExist.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('uses project context when available', () => {
    const code = `
event("entity.updated", {
  payload: z.object({ id: z.string() }),
  from: ["entity.add", "entity.missing"],
})`;
    const context = {
      knownTrailIds: new Set(['entity.add', 'entity.updated']),
    };
    const diagnostics = eventOriginsExist.checkWithContext(
      code,
      TEST_FILE,
      context
    );
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.missing');
  });

  test('passes with project context when all origins exist', () => {
    const code = `
event("entity.updated", {
  payload: z.object({ id: z.string() }),
  from: ["entity.add", "entity.delete"],
})`;
    const context = {
      knownTrailIds: new Set(['entity.add', 'entity.delete']),
    };
    const diagnostics = eventOriginsExist.checkWithContext(
      code,
      TEST_FILE,
      context
    );
    expect(diagnostics.length).toBe(0);
  });

  test('ignores events without from', () => {
    const code = `
event("entity.updated", {
  payload: z.object({ id: z.string() }),
})`;
    const diagnostics = eventOriginsExist.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });
});
