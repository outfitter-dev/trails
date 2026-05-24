import { describe, expect, test } from 'bun:test';

import { noDestructuredCross } from '../rules/no-destructured-cross.js';

describe('no-destructured-cross', () => {
  test('flags body destructuring from the blaze context', () => {
    const code = `
import { trail, Result } from '@ontrails/core';

export const onboard = trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, ctx) => {
    const { cross } = ctx;
    return cross('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-destructured-cross');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('Use ctx.cross(...) directly');
    expect(diagnostics[0]?.message).toContain('Warden can recognize');
  });

  test('flags aliased body destructuring from the blaze context', () => {
    const code = `
trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, ctx) => {
    const { cross: compose } = ctx;
    return compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('entity.onboard');
  });

  test('flags assignment destructuring from the blaze context', () => {
    const code = `
trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, ctx) => {
    let cross;
    ({ cross } = ctx);
    return cross('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('ctx.cross');
  });

  test('flags aliased assignment destructuring from the blaze context', () => {
    const code = `
trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, ctx) => {
    let compose;
    ({ cross: compose } = ctx);
    return compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('flags parameter destructuring from the blaze context', () => {
    const code = `
trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, { cross }) => cross('entity.create', input),
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('composition stays visible');
  });

  test('flags aliased parameter destructuring from the blaze context', () => {
    const code = `
trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, { cross: compose }) =>
    compose('entity.create', input),
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('allows direct ctx.cross calls', () => {
    const code = `
trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, ctx) => {
    return ctx.cross('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores destructuring outside trail blazes', () => {
    const code = `
function run(ctx) {
  const { cross } = ctx;
  return cross('entity.create', {});
}
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/routes/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores nested functions that destructure unrelated values', () => {
    const code = `
trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, ctx) => {
    const helper = (other) => {
      const { cross } = other;
      return cross;
    };
    return ctx.cross('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores destructuring from a shadowed context name', () => {
    const code = `
trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, ctx) => {
    {
      const ctx = { cross: () => null };
      const { cross } = ctx;
      cross();
    }
    return ctx.cross('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores assignment destructuring from a shadowed context name', () => {
    const code = `
trail('entity.onboard', {
  crosses: ['entity.create'],
  blaze: async (input, ctx) => {
    {
      const ctx = { cross: () => null };
      let cross;
      ({ cross } = ctx);
      cross();
    }
    return ctx.cross('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores test files', () => {
    const code = `
trail('entity.onboard', {
  blaze: async (input, ctx) => {
    const { cross } = ctx;
    return cross('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCross.check(
      code,
      'src/__tests__/onboard.test.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });
});
