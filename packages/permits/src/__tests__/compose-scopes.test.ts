import { describe, expect, test } from 'bun:test';

import { Result, topo, trail, validateTopo } from '@ontrails/core';
import { z } from 'zod';

import { validatePermits } from '../rules.js';

const makeTrail = (
  id: string,
  scopes: readonly string[] | 'public' | undefined,
  composes: readonly string[] = []
) =>
  trail(id, {
    composes,
    implementation: () => Result.ok({}),
    input: z.object({}),
    intent: 'read',
    ...(scopes === undefined
      ? {}
      : { permit: scopes === 'public' ? scopes : { scopes } }),
  });

const check = (trails: Parameters<typeof validatePermits>[0]) =>
  validatePermits(trails).filter(
    (diagnostic) => diagnostic.rule === 'composeScopeCoverage'
  );

describe('compose scope coverage', () => {
  test('reports a composed scope missing from the parent contract', () => {
    const child = makeTrail('entity.remove', ['entity:remove']);
    const parent = makeTrail('entity.archive', ['entity:read'], [child.id]);

    expect(check([parent, child])).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('entity:remove'),
        rule: 'composeScopeCoverage',
        severity: 'warn',
        trailId: parent.id,
      }),
    ]);
  });

  test('accepts a parent declaring every composed scope', () => {
    const child = makeTrail('entity.remove', ['entity:remove']);
    const parent = makeTrail(
      'entity.archive',
      ['entity:read', 'entity:remove'],
      [child.id]
    );

    expect(check([parent, child])).toEqual([]);
  });

  test.each(['public', undefined] as const)(
    'treats parent posture %s as declaring no scopes',
    (posture) => {
      const child = makeTrail('entity.remove', ['entity:remove']);
      const parent = makeTrail('entity.archive', posture, [child.id]);

      expect(check([parent, child])).toEqual([
        expect.objectContaining({ trailId: parent.id }),
      ]);
    }
  );

  test('public and undeclared children add no scope requirements', () => {
    const publicChild = makeTrail('entity.public', 'public');
    const undeclaredChild = makeTrail('entity.undeclared');
    const parent = makeTrail(
      'entity.read',
      [],
      [publicChild.id, undeclaredChild.id]
    );

    expect(check([parent, publicChild, undeclaredChild])).toEqual([]);
  });

  test('checks transitive scopes through a public intermediate trail', () => {
    const leaf = makeTrail('entity.remove', ['entity:read', 'entity:remove']);
    const middle = makeTrail('entity.dispatch', 'public', [leaf.id]);
    const parent = makeTrail('entity.archive', ['entity:read'], [middle.id]);
    const diagnostics = check([parent, middle, leaf]);

    expect(diagnostics).toHaveLength(2);
    expect(
      diagnostics.find((item) => item.trailId === parent.id)?.message
    ).toContain('entity:remove');
    expect(
      diagnostics.find((item) => item.trailId === middle.id)?.message
    ).toContain('entity:read');
  });

  test('terminates cycles and reports each parent once', () => {
    const first = makeTrail(
      'entity.first',
      ['entity:first'],
      ['entity.second']
    );
    const second = makeTrail('entity.second', ['entity:second'], [first.id]);

    expect(check([first, second])).toEqual([
      expect.objectContaining({ trailId: first.id }),
      expect.objectContaining({ trailId: second.id }),
    ]);
  });

  test('does not expand wildcard-looking scopes', () => {
    const child = makeTrail('entity.read', ['entity:read']);
    const parent = makeTrail('entity.dispatch', ['entity:*'], [child.id]);

    expect(check([parent, child])).toHaveLength(1);
  });

  test('deduplicates scopes reached through multiple composition paths', () => {
    const leaf = makeTrail('entity.remove', ['entity:write', 'entity:read']);
    const first = makeTrail('entity.first', 'public', [leaf.id]);
    const second = makeTrail('entity.second', 'public', [leaf.id]);
    const parent = makeTrail('entity.archive', [], [first.id, second.id]);
    const diagnostics = check([parent, first, second, leaf]).filter(
      (item) => item.trailId === parent.id
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('entity:read, entity:write.');
  });

  test('checks a directly callable live historical fork', () => {
    const leaf = makeTrail('entity.remove', ['entity:remove']);
    const parent = trail('entity.archive', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      intent: 'read',
      output: z.object({}),
      permit: 'public',
      version: 2,
      versions: {
        1: {
          composes: [leaf],
          implementation: () => Result.ok({}),
          input: z.object({}),
          output: z.object({}),
        },
      },
    });

    expect(
      validateTopo(topo('live-fork-scopes', { leaf, parent })).isOk()
    ).toBe(true);
    expect(check([parent, leaf])).toEqual([
      expect.objectContaining({ trailId: parent.id }),
    ]);
  });

  test('reaches live fork requirements through plain declared trail IDs', () => {
    const leaf = makeTrail('entity.remove', ['entity:remove']);
    const child = trail('entity.dispatch', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      intent: 'read',
      output: z.object({}),
      permit: 'public',
      version: 2,
      versions: {
        1: {
          composes: [leaf.id],
          implementation: () => Result.ok({}),
          input: z.object({}),
          output: z.object({}),
        },
      },
    });
    const parent = makeTrail('entity.archive', [], [child.id]);

    expect(
      validateTopo(
        topo('reachable-fork-scopes', { child, leaf, parent })
      ).isOk()
    ).toBe(true);
    expect(check([parent, child, leaf])).toEqual([
      expect.objectContaining({ trailId: parent.id }),
      expect.objectContaining({ trailId: child.id }),
    ]);
  });

  test('ignores archived fork composition requirements', () => {
    const leaf = makeTrail('entity.remove', ['entity:remove']);
    const parent = trail('entity.archive', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      intent: 'read',
      output: z.object({}),
      permit: 'public',
      version: 2,
      versions: {
        1: {
          composes: [leaf],
          implementation: () => Result.ok({}),
          input: z.object({}),
          output: z.object({}),
          status: { state: 'archived' },
        },
      },
    });

    expect(check([parent, leaf])).toEqual([]);
  });
});
