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
  blaze: async (input, ctx) => {
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
  blaze: async (input, ctx) => {
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
  blaze: async (input, ctx) => {
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
  blaze: async (input, ctx) => {
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
  blaze: async (input, ctx) => {
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
  blaze: async (input, ctx) => {
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

  test('ignores computed member access like ns[trail]()', () => {
    // Computed bracket access may resolve to any runtime value; it must not
    // be treated as a trail() call just because the key is an identifier
    // literally named `trail`.
    const code = `
import { Request, Response } from "express";
const trail = "entity.show";
ns[trail]("entity.show", { blaze: async () => Result.ok(null) });
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
  blaze: async (input, ctx) => Result.ok(data)
})`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.edit');
  });

  test('passes when detour target exists', () => {
    const code = `
trail("entity.edit", {
  blaze: async (input, ctx) => Result.ok(data)
})

trail("entity.show", {
  detours: [{ target: "entity.edit" }],
  blaze: async (input, ctx) => Result.ok(data)
})`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('uses project context when available', () => {
    const code = `
trail("entity.show", {
  detours: [{ target: "entity.edit" }],
  blaze: async (input, ctx) => Result.ok(data)
})`;
    const context = { knownTrailIds: new Set(['entity.show', 'entity.edit']) };
    const diagnostics = validDetourRefs.checkWithContext(
      code,
      TEST_FILE,
      context
    );
    expect(diagnostics.length).toBe(0);
  });

  test('flags detour target in trail with crossings that does not exist', () => {
    const code = `
trail("entity.onboard", {
  detours: [{ target: "entity.missing" }],
  crosses: ["entity.create"],
  blaze: async (input, ctx) => Result.ok(data)
})`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.missing');
  });

  test('passes when trail with crossings detour target exists', () => {
    const code = `
trail("entity.fallback", {
  blaze: async (input, ctx) => Result.ok(data)
})

trail("entity.onboard", {
  detours: [{ target: "entity.fallback" }],
  crosses: ["entity.create"],
  blaze: async (input, ctx) => Result.ok(data)
})`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('ignores trail/detour patterns embedded in template literal payloads', () => {
    const code = `
const sample = \`
trail("entity.fallback", {
  blaze: async (input, ctx) => Result.ok(data)
})

trail("entity.show", {
  detours: [{ target: "entity.fallback" }],
  blaze: async (input, ctx) => Result.ok(data)
})
\`;
`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('flags string-literal detour entries without an object wrapper', () => {
    const code = `
trail("entity.show", {
  detours: ["entity.missing"],
  blaze: async (input, ctx) => Result.ok(data)
})`;
    const diagnostics = validDetourRefs.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.missing');
  });

  describe('backtick literals', () => {
    test('flags backtick-literal detour target in an object wrapper', () => {
      const code = `
trail("entity.show", {
  detours: [{ target: \`entity.missing\` }],
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });

    test('passes when backtick-literal detour target exists', () => {
      const code = `
trail("entity.fallback", {
  blaze: async (input, ctx) => Result.ok(data)
})

trail("entity.show", {
  detours: [{ target: \`entity.fallback\` }],
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(0);
    });

    test('flags bare backtick-literal detour entries', () => {
      const code = `
trail("entity.show", {
  detours: [\`entity.missing\`],
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });

    test('flags quoted "target" key inside detour object', () => {
      const code = `
trail("entity.show", {
  detours: [{ "target": "entity.missing" }],
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });

    test('flags detours when both "detours" and "target" keys are quoted', () => {
      const code = `
trail("entity.show", {
  "detours": [{ "target": "entity.missing" }],
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });

    test('flags mixed quoted-and-unquoted detour keys', () => {
      const code = `
trail("entity.show", {
  detours: [{ "target": "entity.missing" }],
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });

    test('flags detour target on a trail whose id is a backtick literal', () => {
      const code = `
trail(\`entity.show\`, {
  detours: [{ target: "entity.missing" }],
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
      expect(diagnostics[0]?.message).toContain('entity.show');
    });
  });

  describe('transparent expression wrappers', () => {
    test('flags detour target when the detours array is wrapped in `as const`', () => {
      const code = `
trail("entity.show", {
  detours: [{ target: "entity.missing" }] as const,
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });

    test('flags detour target when the detours array uses `satisfies`', () => {
      const code = `
trail("entity.show", {
  detours: [{ target: "entity.missing" }] satisfies readonly Detour[],
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });

    test('flags detour target when the detours array is parenthesized', () => {
      const code = `
trail("entity.show", {
  detours: ([{ target: "entity.missing" }]),
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });

    test('flags detour target when the detours array uses a non-null assertion', () => {
      const code = `
trail("entity.show", {
  detours: [{ target: "entity.missing" }]!,
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });

    test('flags detour target when `target` property value uses `as const`', () => {
      const code = `
trail("entity.show", {
  detours: [{ target: "entity.missing" as const }],
  blaze: async (input, ctx) => Result.ok(data)
})`;
      const diagnostics = validDetourRefs.check(code, TEST_FILE);
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0]?.message).toContain('entity.missing');
    });
  });
});

// ---------------------------------------------------------------------------
// no-direct-impl-in-route
// ---------------------------------------------------------------------------
describe('no-direct-impl-in-route', () => {
  test('warns on direct .blaze() call in trail with crossings', () => {
    const code = `
trail("entity.onboard", {
  crosses: ["entity.create"],
  blaze: async (input, ctx) => {
    const result = await entityCreate.blaze(data);
    return Result.ok(result);
  }
})`;
    const diagnostics = noDirectImplInRoute.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('ctx.cross');
  });

  test('allows ctx.cross() calls', () => {
    const code = `
trail("entity.onboard", {
  crosses: ["entity.create"],
  blaze: async (input, ctx) => {
    const result = await ctx.cross("entity.create", data);
    return Result.ok(result);
  }
})`;
    const diagnostics = noDirectImplInRoute.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('ignores trails without crossings', () => {
    const code = `
trail("entity.show", {
  blaze: async (input, ctx) => {
    const result = await someTrail.blaze(data);
    return Result.ok(result);
  }
})`;
    const diagnostics = noDirectImplInRoute.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });

  test('ignores files without trail() calls', () => {
    const code = `
const result = await someTrail.blaze(data);`;
    const diagnostics = noDirectImplInRoute.check(code, TEST_FILE);
    expect(diagnostics.length).toBe(0);
  });
});
