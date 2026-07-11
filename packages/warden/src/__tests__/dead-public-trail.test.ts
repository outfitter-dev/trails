import { describe, expect, test } from 'bun:test';

import { deadPublicTrail } from '../rules/dead-public-trail.js';

const TEST_FILE = 'packages/regrade/src/downstream/report.ts';

describe('dead-public-trail', () => {
  test('warns when an exported public trail is not topo-registered, composed, or activated', () => {
    const code = `
export const regradeReportTrail = trail('regrade.downstream.report', {
  implementation: async () => Result.ok({}),
});
`;

    const diagnostics = deadPublicTrail.checkWithContext(code, TEST_FILE, {
      knownTrailIds: new Set(['regrade.downstream.report', 'regrade']),
      topoTrailIds: new Set(['regrade']),
    });

    expect(diagnostics).toEqual([
      {
        filePath: TEST_FILE,
        line: 2,
        message:
          'Exported public trail "regrade.downstream.report" is not registered in a configured app topo, composed by another trail, or activated by on:. Anchor the contract in a topo, compose it, mark it internal, or remove the public export.',
        rule: 'dead-public-trail',
        severity: 'warn',
      },
    ]);
  });

  test('stays quiet when the exported public trail is registered in a configured topo', () => {
    const code = `
export const operatorTrail = trail('regrade', {
  implementation: async () => Result.ok({}),
});
`;

    const diagnostics = deadPublicTrail.checkWithContext(code, TEST_FILE, {
      knownTrailIds: new Set(['regrade']),
      topoTrailIds: new Set(['regrade']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet when another trail composes the exported public trail', () => {
    const code = `
export const packageTrail = trail('package.report', {
  implementation: async () => Result.ok({}),
});
`;

    const diagnostics = deadPublicTrail.checkWithContext(code, TEST_FILE, {
      composeTargetTrailIds: new Set(['package.report']),
      knownTrailIds: new Set(['package.report', 'operator']),
      topoTrailIds: new Set(['operator']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet for unexported local public helpers', () => {
    const code = `
const helperTrail = trail('package.helper', {
  implementation: async () => Result.ok({}),
});
`;

    const diagnostics = deadPublicTrail.checkWithContext(code, TEST_FILE, {
      knownTrailIds: new Set(['package.helper', 'operator']),
      topoTrailIds: new Set(['operator']),
    });

    expect(diagnostics).toEqual([]);
  });

  test('warns when a local public trail is exported through a named specifier', () => {
    const code = `
const packageTrail = trail('package.report', {
  implementation: async () => Result.ok({}),
});

export { packageTrail as regradeReportTrail };
`;

    const diagnostics = deadPublicTrail.checkWithContext(code, TEST_FILE, {
      knownTrailIds: new Set(['package.report', 'operator']),
      topoTrailIds: new Set(['operator']),
    });

    expect(diagnostics).toEqual([
      {
        filePath: TEST_FILE,
        line: 2,
        message:
          'Exported public trail "package.report" is not registered in a configured app topo, composed by another trail, or activated by on:. Anchor the contract in a topo, compose it, mark it internal, or remove the public export.',
        rule: 'dead-public-trail',
        severity: 'warn',
      },
    ]);
  });

  test('warns when a local public trail is exported as default by identifier', () => {
    const code = `
const packageTrail = trail('package.report', {
  implementation: async () => Result.ok({}),
});

export default packageTrail;
`;

    const diagnostics = deadPublicTrail.checkWithContext(code, TEST_FILE, {
      knownTrailIds: new Set(['package.report', 'operator']),
      topoTrailIds: new Set(['operator']),
    });

    expect(diagnostics).toEqual([
      {
        filePath: TEST_FILE,
        line: 2,
        message:
          'Exported public trail "package.report" is not registered in a configured app topo, composed by another trail, or activated by on:. Anchor the contract in a topo, compose it, mark it internal, or remove the public export.',
        rule: 'dead-public-trail',
        severity: 'warn',
      },
    ]);
  });

  test('stays quiet without topo context', () => {
    const code = `
export const packageTrail = trail('package.report', {
  implementation: async () => Result.ok({}),
});
`;

    const diagnostics = deadPublicTrail.checkWithContext(code, TEST_FILE, {
      knownTrailIds: new Set(['package.report']),
    });

    expect(diagnostics).toEqual([]);
  });
});
