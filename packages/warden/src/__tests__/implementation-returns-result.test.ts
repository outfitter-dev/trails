import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import * as nodeFs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearImplementationReturnsResultCache,
  implementationReturnsResult,
} from '../rules/implementation-returns-result.js';

const TEST_FILE = 'test.ts';

const writeReadCountFixture = (
  writeFile: (name: string, content: string) => string
): { readonly implPath: string; readonly caller: string } => {
  const implPath = writeFile(
    'impl-readcount.ts',
    `const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });

export default helper;
`
  );
  writeFile(
    'barrel-readcount.ts',
    `export { default as foo } from './impl-readcount.js';
`
  );
  const caller = writeFile(
    'caller-readcount.ts',
    `import { foo } from './barrel-readcount.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return foo();
  }
})`
  );
  return { caller, implPath };
};

describe('implementation-returns-result', () => {
  test('flags raw object return in trail implementation', () => {
    const code = `
trail("entity.show", {
  blaze: async (input, ctx) => {
    return { name: "foo" };
  }
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.rule).toBe('implementation-returns-result');
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('allows Result.ok() and returning ctx.cross() results', () => {
    const code = `
trail("entity.onboard", {
  crosses: ["entity.create"],
  blaze: async (input, ctx) => {
    const result = await ctx.cross("entity.create", input);
    return result;
  }
})

trail("entity.create", {
  blaze: async (input, ctx) => Result.ok({ id: "123" })
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(0);
  });

  test('flags concise raw implementation bodies', () => {
    const code = `
trail("entity.create", {
  blaze: async (input, ctx) => ({ id: "123" })
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.create');
  });

  test('ignores return statements inside nested callbacks like .map()', () => {
    const code = `
trail("entity.list", {
  blaze: async (input, ctx) => {
    const items = ["a", "b", "c"];
    const mapped = items.map((item) => {
      return { name: item };
    });
    const filtered = items.filter((item) => {
      return item !== "b";
    });
    return Result.ok(mapped);
  }
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(0);
  });

  test('ignores return statements inside .then() callbacks', () => {
    const code = `
trail("entity.fetch", {
  blaze: async (input, ctx) => {
    const data = await somePromise.then((res) => {
      return res.json();
    });
    return Result.ok(data);
  }
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(0);
  });

  test('still flags raw returns at the implementation level', () => {
    const code = `
trail("entity.list", {
  blaze: async (input, ctx) => {
    const items = ["a", "b"].map((item) => {
      return { name: item };
    });
    return items;
  }
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('entity.list');
  });

  describe('imported helpers', () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'warden-impl-result-'));
    });

    afterAll(() => {
      rmSync(tmpDir, { force: true, recursive: true });
    });

    const writeFile = (name: string, content: string): string => {
      const path = join(tmpDir, name);
      writeFileSync(path, content);
      return path;
    };

    test('allows imported helper with Promise<Result<...>> return annotation', () => {
      writeFile(
        'result-helper.ts',
        `export const buildReport = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
      );
      const caller = writeFile(
        'caller.ts',
        `import { buildReport } from './result-helper.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return buildReport();
  }
})`
      );

      const diagnostics = implementationReturnsResult.check(
        readFileSync(caller, 'utf8'),
        caller
      );

      expect(diagnostics.length).toBe(0);
    });

    test('flags imported helper without Result return annotation', () => {
      writeFile(
        'plain-helper.ts',
        `export const buildReport = async () => ({ ok: true });
`
      );
      const caller = writeFile(
        'caller-plain.ts',
        `import { buildReport } from './plain-helper.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return buildReport();
  }
})`
      );

      const diagnostics = implementationReturnsResult.check(
        readFileSync(caller, 'utf8'),
        caller
      );

      expect(diagnostics.length).toBe(1);
    });

    test('flags helper imported from bare specifier (node_modules)', () => {
      const caller = writeFile(
        'caller-bare.ts',
        `import { buildReport } from 'some-package';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return buildReport();
  }
})`
      );

      const diagnostics = implementationReturnsResult.check(
        readFileSync(caller, 'utf8'),
        caller
      );

      expect(diagnostics.length).toBe(1);
    });

    test('flags gracefully when target file is unreadable', () => {
      const caller = writeFile(
        'caller-missing.ts',
        `import { buildReport } from './does-not-exist.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return buildReport();
  }
})`
      );

      const diagnostics = implementationReturnsResult.check(
        readFileSync(caller, 'utf8'),
        caller
      );

      expect(diagnostics.length).toBe(1);
    });

    describe('specifier re-exports', () => {
      test('allows specifier re-export with source (export { helper } from ...)', () => {
        writeFile(
          'impl-specifier.ts',
          `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
        );
        writeFile(
          'barrel-specifier.ts',
          `export { helper } from './impl-specifier.js';
`
        );
        const caller = writeFile(
          'caller-specifier.ts',
          `import { helper } from './barrel-specifier.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return helper();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(0);
      });

      test('allows aliased specifier re-export (export { helper as aliased })', () => {
        writeFile(
          'impl-aliased.ts',
          `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
        );
        writeFile(
          'barrel-aliased.ts',
          `export { helper as aliased } from './impl-aliased.js';
`
        );
        const caller = writeFile(
          'caller-aliased.ts',
          `import { aliased } from './barrel-aliased.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return aliased();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(0);
      });

      test('allows specifier re-export without source (same-file)', () => {
        writeFile(
          'barrel-samefile.ts',
          `const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });

export { helper };
`
        );
        const caller = writeFile(
          'caller-samefile.ts',
          `import { helper } from './barrel-samefile.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return helper();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(0);
      });

      test('allows default re-export (export { default as foo } from ...)', () => {
        writeFile(
          'impl-default.ts',
          `const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });

export default helper;
`
        );
        writeFile(
          'barrel-default.ts',
          `export { default as foo } from './impl-default.js';
`
        );
        const caller = writeFile(
          'caller-default.ts',
          `import { foo } from './barrel-default.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return foo();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(0);
      });

      test('reads the re-export target file only once per check (default specifier)', () => {
        // Regression for PR #204: `export { default as foo } from './impl.js'`
        // previously triggered two reads/parses of impl.js within a single
        // check() call — once via the downstream-names walk and once for the
        // default-specifier AST lookup. The loaded target is now threaded
        // through, so impl.js should be read exactly once.
        const { implPath, caller } = writeReadCountFixture(writeFile);

        clearImplementationReturnsResultCache();
        const readSpy = spyOn(nodeFs, 'readFileSync');

        try {
          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );
          expect(diagnostics.length).toBe(0);
          const implReads = readSpy.mock.calls.filter(
            (call) => call[0] === implPath
          );
          expect(implReads.length).toBe(1);
        } finally {
          readSpy.mockRestore();
        }
      });

      test('caps re-export chains beyond one transitive hop', () => {
        // A -> B -> C: caller imports from A, which re-exports from B,
        // which re-exports from C where the helper is declared. The
        // MAX_RERESOLVE_DEPTH=1 cap should prevent resolving C, so the
        // helper name is NOT recognized through the 2-hop chain.
        writeFile(
          'depth-c.ts',
          `export const deepHelper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
        );
        writeFile(
          'depth-b.ts',
          `export { deepHelper } from './depth-c.js';
`
        );
        writeFile(
          'depth-a.ts',
          `export { deepHelper } from './depth-b.js';
`
        );
        const caller = writeFile(
          'caller-depth.ts',
          `import { deepHelper } from './depth-a.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return deepHelper();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        // 2-hop re-export chain exceeds MAX_RERESOLVE_DEPTH, so the helper's
        // Result annotation is not discoverable and the return is flagged.
        expect(diagnostics.length).toBe(1);
      });

      test('cache does not bleed cycle-truncated results into direct imports', () => {
        // A -> B -> A cycle. When A is resolved first (e.g. through a caller
        // that imports from A), resolving B is attempted while A is in the
        // visited set, which truncates B's transitive view back to A. A naive
        // per-target cache would then persist an empty set for B and wrongly
        // flag a later direct import from B.
        writeFile(
          'ctx-a.ts',
          `export { helper } from './ctx-b.js';
`
        );
        writeFile(
          'ctx-b.ts',
          `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });

export { helper as aliasedFromA } from './ctx-a.js';
`
        );
        const callerA = writeFile(
          'caller-ctx-a.ts',
          `import { helper } from './ctx-a.js';

trail("entity.first", {
  blaze: async (input, ctx) => {
    return helper();
  }
})`
        );
        const callerB = writeFile(
          'caller-ctx-b.ts',
          `import { helper } from './ctx-b.js';

trail("entity.second", {
  blaze: async (input, ctx) => {
    return helper();
  }
})`
        );

        // Resolve A first — this walks A -> B (and B -> A is cycle-guarded).
        implementationReturnsResult.check(
          readFileSync(callerA, 'utf8'),
          callerA
        );

        // Now resolve B directly. B's own inline helper must still be
        // recognized as Result-returning, even though an earlier transitive
        // walk touched B under a non-empty parentVisited.
        const diagnostics = implementationReturnsResult.check(
          readFileSync(callerB, 'utf8'),
          callerB
        );

        expect(diagnostics.length).toBe(0);
      });

      test('allows default-imported Result helper (import foo from ...)', () => {
        writeFile(
          'impl-default-import.ts',
          `const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });

export default helper;
`
        );
        const caller = writeFile(
          'caller-default-import.ts',
          `import buildReport from './impl-default-import.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return buildReport();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(0);
      });
    });

    describe('namespace imports and barrel export *', () => {
      test('allows namespace-imported Result helper (import * as ns)', () => {
        writeFile(
          'impl-namespace.ts',
          `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
        );
        const caller = writeFile(
          'caller-namespace.ts',
          `import * as ns from './impl-namespace.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return ns.helper();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(0);
      });

      test('flags namespace-imported non-Result member call', () => {
        writeFile(
          'impl-namespace-mixed.ts',
          `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });

export const nonResultFn = async () => ({ ok: true });
`
        );
        const caller = writeFile(
          'caller-namespace-mixed.ts',
          `import * as ns from './impl-namespace-mixed.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return ns.nonResultFn();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(1);
      });

      test('falls back gracefully on unresolvable namespace import target', () => {
        const caller = writeFile(
          'caller-namespace-missing.ts',
          `import * as ns from './missing-namespace.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return ns.helper();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(1);
      });

      describe('shadowing by param/const/let', () => {
        test('flags ns.helper() when blaze parameter shadows the namespace import', () => {
          writeFile(
            'impl-ns-shadow-param.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-param.ts',
            `import * as ns from './impl-ns-shadow-param.js';

trail("entity.report", {
  blaze: async (ns, ctx) => {
    return ns.helper(ctx);
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          // The blaze parameter \`ns\` shadows the namespace import; \`ns.helper()\`
          // is a call on the parameter, not on the namespace, so the return
          // must be flagged rather than silently treated as a Result helper.
          expect(diagnostics.length).toBe(1);
        });

        test('flags ns.helper() when a local const shadows the namespace import', () => {
          writeFile(
            'impl-ns-shadow-const.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-const.ts',
            `import * as ns from './impl-ns-shadow-const.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    const ns = { helper: () => ({ ok: true }) };
    return ns.helper(input);
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });

        test('flags ns.helper() when a local let shadows the namespace import', () => {
          writeFile(
            'impl-ns-shadow-let.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-let.ts',
            `import * as ns from './impl-ns-shadow-let.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    let ns = input;
    return ns.helper(input);
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });
      });

      describe('shadowing in for/catch scopes', () => {
        test('flags ns.helper() when a for-init const shadows the namespace import', () => {
          writeFile(
            'impl-ns-shadow-for-init.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-for-init.ts',
            `import * as ns from './impl-ns-shadow-for-init.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    for (const ns = 0; ns < 1; ns++) {
      return ns.helper(input);
    }
    return Result.ok({});
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });

        test('flags ns.helper() when a for-of binding shadows the namespace import', () => {
          writeFile(
            'impl-ns-shadow-for-of.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-for-of.ts',
            `import * as ns from './impl-ns-shadow-for-of.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    for (const ns of [1, 2, 3]) {
      return ns.helper(input);
    }
    return Result.ok({});
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });

        test('flags ns.helper() when a catch param shadows the namespace import', () => {
          writeFile(
            'impl-ns-shadow-catch.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-catch.ts',
            `import * as ns from './impl-ns-shadow-catch.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    try {
      return Result.ok({});
    } catch (ns) {
      return ns.helper(input);
    }
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });

        test('flags ns.helper() when a catch param destructures the namespace name', () => {
          writeFile(
            'impl-ns-shadow-catch-destructure.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-catch-destructure.ts',
            `import * as ns from './impl-ns-shadow-catch-destructure.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    try {
      return Result.ok({});
    } catch ({ ns }) {
      return ns.helper(input);
    }
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });
      });

      describe('scope-frame coverage (TRL-347)', () => {
        test('flags ns.helper() when a const ns shadow sits in a function-expression blaze body (FunctionBody frame)', () => {
          // Regression: oxc-parser emits `FunctionBody` for regular
          // `function expression() { ... }` bodies, not `BlockStatement`. Without
          // a FunctionBody scope-frame collector, the `const ns = ...` at the
          // top of this body would not push a frame and the module-level
          // namespace import would leak through.
          writeFile(
            'impl-ns-shadow-fn-expr.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-fn-expr.ts',
            `import * as ns from './impl-ns-shadow-fn-expr.js';

trail("entity.report", {
  blaze: async function(input, ctx) {
    const ns = { helper: () => ({ ok: true }) };
    return ns.helper(input);
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });

        test('flags ns.helper() when a hoisted var ns shadows the namespace import', () => {
          // Regression: a `var ns` nested inside a block hoists to the
          // enclosing blaze's function scope. Without function-body-level var
          // hoisting, the namespace import is read as the receiver and the
          // return is silently treated as a Result helper.
          writeFile(
            'impl-ns-shadow-hoisted-var.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-hoisted-var.ts',
            `import * as ns from './impl-ns-shadow-hoisted-var.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    if (input) {
      var ns = { helper: () => ({ ok: true }) };
    }
    return ns.helper(input);
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });

        test('flags ns.helper() when an unbraced switch case declares a shadowing const', () => {
          // Regression: an unbraced switch case (`case N: const ns = ...;`)
          // does not push a BlockStatement frame. Without the enclosing
          // SwitchStatement collector, the shadow is invisible to the walker.
          writeFile(
            'impl-ns-shadow-switch.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-switch.ts',
            `import * as ns from './impl-ns-shadow-switch.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    switch (input.kind) {
      case 'a':
        const ns = { helper: () => ({ ok: true }) };
        return ns.helper(input);
      default:
        return Result.ok({});
    }
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });

        test('flags ns.helper() in a sibling switch case when an earlier case declares a shadowing const', () => {
          // Regression: `switch` shares a single lexical scope across every
          // case. A `const ns = ...` in case 'a' shadows the module-level
          // namespace import for every sibling case (including via
          // fall-through). A per-SwitchCase frame would pop the binding when
          // case 'a' ended and miss the shadow in case 'b'.
          writeFile(
            'impl-ns-shadow-switch-fallthrough.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-switch-fallthrough.ts',
            `import * as ns from './impl-ns-shadow-switch-fallthrough.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    switch (input.kind) {
      case 'a':
        const ns = { helper: () => ({ ok: true }) };
        return ns.helper(input);
      case 'b':
        return ns.helper(input);
      default:
        return Result.ok({});
    }
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          // Both case 'a' and case 'b' should fire — the const declared in
          // case 'a' is visible across the entire switch scope.
          expect(diagnostics.length).toBe(2);
        });

        test('still resolves ns.helper() correctly when the switch case is braced', () => {
          // Regression: braced cases create a BlockStatement frame nested
          // inside the SwitchStatement frame. The shadow must still apply
          // inside that block, and the sibling case must still see the
          // namespace import (no SwitchStatement-level binding leaks).
          writeFile(
            'impl-ns-shadow-switch-braced.ts',
            `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-shadow-switch-braced.ts',
            `import * as ns from './impl-ns-shadow-switch-braced.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    switch (input.kind) {
      case 'a': {
        const ns = { helper: () => ({ ok: true }) };
        return ns.helper(input);
      }
      case 'b':
        return ns.helper(input);
      default:
        return Result.ok({});
    }
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          // Only the braced case 'a' should fire — the `const ns` is scoped
          // to the inner block and does not leak into case 'b'.
          expect(diagnostics.length).toBe(1);
        });

        test('flags ns.anything() when the namespace target exports zero Result helpers', () => {
          // Regression: when the target file has no Result-returning exports,
          // `resolveNamespaceSpecifier` used to drop the entry entirely. That
          // made `isNamespaceHelperMemberCall` return false because the
          // namespace binding was absent from the map — the general return-
          // value analysis then fired for the wrong reason. The entry is now
          // recorded with an empty set so the call is correctly identified as
          // a non-Result-helper namespace member call.
          writeFile(
            'impl-ns-empty.ts',
            `export const nonResultFn = async () => ({ ok: true });
`
          );
          const caller = writeFile(
            'caller-ns-empty.ts',
            `import * as ns from './impl-ns-empty.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return ns.nonResultFn();
  }
})`
          );

          const diagnostics = implementationReturnsResult.check(
            readFileSync(caller, 'utf8'),
            caller
          );

          expect(diagnostics.length).toBe(1);
        });
      });

      test('allows named import through `export * from` barrel', () => {
        writeFile(
          'impl-star.ts',
          `export const helper = async (): Promise<Result<object, Error>> =>
  Result.ok({ ok: true });
`
        );
        writeFile(
          'barrel-star.ts',
          `export * from './impl-star.js';
`
        );
        const caller = writeFile(
          'caller-star.ts',
          `import { helper } from './barrel-star.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return helper();
  }
})`
        );

        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(0);
      });

      test('falls back gracefully on `export * from` cycle', () => {
        writeFile(
          'star-cycle-a.ts',
          `export * from './star-cycle-b.js';
`
        );
        writeFile(
          'star-cycle-b.ts',
          `export * from './star-cycle-a.js';
`
        );
        const caller = writeFile(
          'caller-star-cycle.ts',
          `import { helper } from './star-cycle-a.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return helper();
  }
})`
        );

        // Should not hang; the helper is not resolvable through the cycle.
        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(1);
      });

      test('falls back gracefully on re-export cycle', () => {
        writeFile(
          'cycle-a.ts',
          `export { helper } from './cycle-b.js';
`
        );
        writeFile(
          'cycle-b.ts',
          `export { helper } from './cycle-a.js';
`
        );
        const caller = writeFile(
          'caller-cycle.ts',
          `import { helper } from './cycle-a.js';

trail("entity.report", {
  blaze: async (input, ctx) => {
    return helper();
  }
})`
        );

        // Should not hang. Since the helper's annotation cannot be resolved
        // through the cycle, it falls back to flagging the return as non-Result.
        const diagnostics = implementationReturnsResult.check(
          readFileSync(caller, 'utf8'),
          caller
        );

        expect(diagnostics.length).toBe(1);
      });
    });
  });

  test('allows returning explicitly Result-typed local helpers', () => {
    const code = `
const buildDetail = (trailId: string): Result<object, Error> =>
  Result.ok({ trailId });

const buildDiff = async (): Promise<Result<object, Error>> =>
  Result.ok({ breaking: [] });

trail("survey", {
  blaze: async (input, ctx) => {
    if (input.diff) {
      return await buildDiff();
    }

    return buildDetail(input.trailId);
  }
})`;

    const diagnostics = implementationReturnsResult.check(code, TEST_FILE);

    expect(diagnostics.length).toBe(0);
  });
});
