import { describe, expect, test } from 'bun:test';

import { noRedundantResultErrorWrap } from '../rules/no-redundant-result-error-wrap.js';

const TEST_FILE = 'src/trails/entity.ts';

describe('no-redundant-result-error-wrap', () => {
  test('flags Result.err(result.error) for ctx.compose results', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.load', {
  composes: ['entity.fetch'],
  blaze: async (input, ctx) => {
    const fetched = await ctx.compose('entity.fetch', input);
    if (fetched.isErr()) {
      return Result.err(fetched.error);
    }
    return Result.ok(fetched.value);
  },
});
`;

    const diagnostics = noRedundantResultErrorWrap.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-redundant-result-error-wrap');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('entity.load');
    expect(diagnostics[0]?.message).toContain('Return fetched directly');
  });

  test('flags Result.err(result.error) for Result helper variables', () => {
    const code = `
import { Result, trail } from '@ontrails/core';
import type { Result as ResultType } from '@ontrails/core';

const parseInput = (): ResultType<{ readonly id: string }, Error> =>
  Result.err(new Error('bad'));

trail('entity.load', {
  blaze: async (input, ctx) => {
    const parsed = parseInput();
    if (parsed.isErr()) {
      return Result.err(parsed.error);
    }
    return Result.ok(parsed.value);
  },
});
`;

    const diagnostics = noRedundantResultErrorWrap.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('Return parsed directly');
  });

  test('allows returning the Result directly', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.load', {
  composes: ['entity.fetch'],
  blaze: async (input, ctx) => {
    const fetched = await ctx.compose('entity.fetch', input);
    if (fetched.isErr()) {
      return fetched;
    }
    return Result.ok(fetched.value);
  },
});
`;

    expect(noRedundantResultErrorWrap.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not flag transformed errors', () => {
    const code = `
import { InternalError, Result, trail } from '@ontrails/core';

trail('entity.load', {
  composes: ['entity.fetch'],
  blaze: async (input, ctx) => {
    const fetched = await ctx.compose('entity.fetch', input);
    if (fetched.isErr()) {
      return Result.err(new InternalError(fetched.error.message));
    }
    return Result.ok(fetched.value);
  },
});
`;

    expect(noRedundantResultErrorWrap.check(code, TEST_FILE)).toEqual([]);
  });

  test('does not flag variables without visible Result provenance', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.load', {
  blaze: async (input, ctx) => {
    const response = await fetch(input.url);
    if (!response.ok) {
      return Result.err(response.error);
    }
    return Result.ok(response);
  },
});
`;

    expect(noRedundantResultErrorWrap.check(code, TEST_FILE)).toEqual([]);
  });

  test('clears provenance after reassignment', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.load', {
  composes: ['entity.fetch'],
  blaze: async (input, ctx) => {
    let fetched = await ctx.compose('entity.fetch', input);
    fetched = { error: new Error('different') };
    return Result.err(fetched.error);
  },
});
`;

    expect(noRedundantResultErrorWrap.check(code, TEST_FILE)).toEqual([]);
  });

  test('keeps block-scoped Result provenance from leaking to outer shadows', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.load', {
  composes: ['entity.fetch'],
  blaze: async (input, ctx) => {
    const fetched = { error: new Error('plain') };
    if (input.fetch) {
      const fetched = await ctx.compose('entity.fetch', input);
      if (fetched.isErr()) {
        return fetched;
      }
    }
    return Result.err(fetched.error);
  },
});
`;

    expect(noRedundantResultErrorWrap.check(code, TEST_FILE)).toEqual([]);
  });

  test('block-scoped shadows do not erase outer Result provenance', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.load', {
  composes: ['entity.fetch'],
  blaze: async (input, ctx) => {
    const fetched = await ctx.compose('entity.fetch', input);
    if (input.local) {
      const fetched = { error: new Error('plain') };
      void fetched;
    }
    if (fetched.isErr()) {
      return Result.err(fetched.error);
    }
    return Result.ok(fetched.value);
  },
});
`;

    const diagnostics = noRedundantResultErrorWrap.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('Return fetched directly');
  });

  test('does not treat a shadowed helper name as Result provenance', () => {
    const code = `
import { Result, trail } from '@ontrails/core';
import type { Result as ResultType } from '@ontrails/core';

const parseInput = (): ResultType<{ readonly id: string }, Error> =>
  Result.err(new Error('bad'));

trail('entity.load', {
  blaze: async (input, ctx) => {
    const parseInput = () => ({ error: new Error('plain') });
    const parsed = parseInput();
    return Result.err(parsed.error);
  },
});
`;

    expect(noRedundantResultErrorWrap.check(code, TEST_FILE)).toEqual([]);
  });

  test('tracks scoped Result helper calls as Result provenance', () => {
    const code = `
import { Result, trail } from '@ontrails/core';
import type { Result as ResultType } from '@ontrails/core';

trail('entity.load', {
  blaze: async (input, ctx) => {
    const parseInput = (): ResultType<{ readonly id: string }, Error> =>
      Result.err(new Error('bad'));
    const parsed = parseInput();
    return Result.err(parsed.error);
  },
});
`;

    const diagnostics = noRedundantResultErrorWrap.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('Return parsed directly');
  });

  test('ignores return statements inside nested callbacks', () => {
    const code = `
import { Result, trail } from '@ontrails/core';

trail('entity.load', {
  composes: ['entity.fetch'],
  blaze: async (input, ctx) => {
    const fetched = await ctx.compose('entity.fetch', input);
    input.items.map(() => {
      return Result.err(fetched.error);
    });
    return fetched;
  },
});
`;

    expect(noRedundantResultErrorWrap.check(code, TEST_FILE)).toEqual([]);
  });
});
