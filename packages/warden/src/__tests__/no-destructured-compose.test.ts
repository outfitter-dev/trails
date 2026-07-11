import { describe, expect, test } from 'bun:test';

import { noDestructuredCompose } from '../rules/no-destructured-compose.js';

describe('no-destructured-compose', () => {
  test('flags body destructuring from the implementation context', () => {
    const code = `
import { trail, Result } from '@ontrails/core';

export const onboard = trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, ctx) => {
    const { compose } = ctx;
    return compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-destructured-compose');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('Use ctx.compose(...) directly');
    expect(diagnostics[0]?.message).toContain('Warden can recognize');
  });

  test('flags aliased body destructuring from the implementation context', () => {
    const code = `
trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, ctx) => {
    const { compose: compose } = ctx;
    return compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('entity.onboard');
  });

  test('flags assignment destructuring from the implementation context', () => {
    const code = `
trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, ctx) => {
    let compose;
    ({ compose } = ctx);
    return compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('ctx.compose');
  });

  test('flags aliased assignment destructuring from the implementation context', () => {
    const code = `
trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, ctx) => {
    let compose;
    ({ compose: compose } = ctx);
    return compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('flags parameter destructuring from the implementation context', () => {
    const code = `
trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, { compose }) => compose('entity.create', input),
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('composition stays visible');
  });

  test('flags aliased parameter destructuring from the implementation context', () => {
    const code = `
trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, { compose: compose }) =>
    compose('entity.create', input),
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(1);
  });

  test('allows direct ctx.compose calls', () => {
    const code = `
trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, ctx) => {
    return ctx.compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores destructuring outside trail implementations', () => {
    const code = `
function run(ctx) {
  const { compose } = ctx;
  return compose('entity.create', {});
}
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/routes/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores nested functions that destructure unrelated values', () => {
    const code = `
trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, ctx) => {
    const helper = (other) => {
      const { compose } = other;
      return compose;
    };
    return ctx.compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores destructuring from a shadowed context name', () => {
    const code = `
trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, ctx) => {
    {
      const ctx = { compose: () => null };
      const { compose } = ctx;
      compose();
    }
    return ctx.compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores assignment destructuring from a shadowed context name', () => {
    const code = `
trail('entity.onboard', {
  composes: ['entity.create'],
  implementation: async (input, ctx) => {
    {
      const ctx = { compose: () => null };
      let compose;
      ({ compose } = ctx);
      compose();
    }
    return ctx.compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/trails/onboard.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores test files', () => {
    const code = `
trail('entity.onboard', {
  implementation: async (input, ctx) => {
    const { compose } = ctx;
    return compose('entity.create', input);
  },
});
`;

    const diagnostics = noDestructuredCompose.check(
      code,
      'src/__tests__/onboard.test.ts'
    );

    expect(diagnostics).toHaveLength(0);
  });
});
