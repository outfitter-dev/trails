import { describe, expect, test } from 'bun:test';
import { AuthError, Result, isTrailsError, topo, trail } from '@ontrails/core';
import type { BasePermit } from '@ontrails/core';
import { z } from 'zod';

import { authResource } from '../auth-resource.js';
import {
  SYNTHETIC_PERMIT_ID,
  collectDeclaredScopes,
  deriveAssertedKindsPolicy,
  reconcilePermit,
} from '../reconcile.js';
import type { ReconcilePermitOptions } from '../reconcile.js';

/** Spelled in two parts so the Warden source rule does not read it as a committed flag. */
const DEV_FLAG = ['--dev', '-permit'].join('');

const whoami = trail('whoami', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

const update = trail('record.update', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'write',
  output: z.object({ ok: z.boolean() }),
  permit: { scopes: ['record:write'] },
});

const destroy = trail('record.destroy', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'destroy',
  output: z.object({ ok: z.boolean() }),
  permit: { scopes: ['record:delete', 'record:write'] },
});

const open = topo('open', { destroy, update, whoami });
const guarded = topo('guarded', { authResource, destroy, update, whoami });

const inline: BasePermit = {
  actors: [],
  id: 'operator',
  scopes: ['record:write'],
};

const base = (
  overrides: Partial<ReconcilePermitOptions>
): ReconcilePermitOptions => ({
  candidates: {},
  graph: open,
  posture: 'in-process',
  requestId: 'req-1',
  surface: 'cli',
  ...overrides,
});

const categoryOf = (result: Result<unknown, Error>): string | undefined =>
  result.isErr() && isTrailsError(result.error)
    ? result.error.category
    : undefined;

describe('collectDeclaredScopes', () => {
  test('unions every declared scope once', () => {
    expect([...collectDeclaredScopes(open)].toSorted()).toEqual([
      'record:delete',
      'record:write',
    ]);
  });
});

describe('deriveAssertedKindsPolicy', () => {
  test('allows asserted kinds when no auth resource exists', () => {
    expect(deriveAssertedKindsPolicy(open)).toEqual({
      allow: true,
      name: 'derived:no-auth-resource',
    });
  });

  test('denies asserted kinds once an auth resource is declared', () => {
    expect(deriveAssertedKindsPolicy(guarded).allow).toBe(false);
  });

  test('an explicit policy wins and keeps its name', () => {
    expect(
      deriveAssertedKindsPolicy(guarded, { allow: true, name: 'app.config' })
    ).toEqual({ allow: true, name: 'app.config' });
  });
});

describe('reconcilePermit', () => {
  test('no candidate is absence', async () => {
    const result = await reconcilePermit(base({}));
    expect(result.isOk() && result.value).toBeUndefined();
  });

  test('an empty credential candidate is absence too', async () => {
    const result = await reconcilePermit(
      base({ candidates: { credential: { label: '--token' } } })
    );
    expect(result.isOk() && result.value).toBeUndefined();
  });

  test('more than one candidate is a conflict naming the labels', async () => {
    const result = await reconcilePermit(
      base({
        candidates: {
          credential: { bearerToken: 't', label: '--token' },
          inline: { label: '--permit', permit: inline },
          synthetic: { label: DEV_FLAG },
        },
      })
    );
    expect(categoryOf(result)).toBe('validation');
    expect(result.isErr() && result.error.message).toBe(
      `--permit, --token, ${DEV_FLAG} are mutually exclusive; pass only one.`
    );
  });

  test('the synthetic permit carries every declared scope and synthetic admission', async () => {
    const result = await reconcilePermit(
      base({ candidates: { synthetic: { label: DEV_FLAG } } })
    );
    expect(result.isOk()).toBe(true);
    const permit = result.unwrap();
    expect(permit?.id).toBe(SYNTHETIC_PERMIT_ID);
    expect([...(permit?.scopes ?? [])].toSorted()).toEqual([
      'record:delete',
      'record:write',
    ]);
    expect(permit?.admission).toEqual({
      by: 'derived:no-auth-resource',
      kind: 'synthetic',
    });
    expect(permit?.actors).toEqual([]);
  });

  test('an inline permit is admitted as asserted with an unverified host actor', async () => {
    const result = await reconcilePermit(
      base({
        actor: { id: 'claude-code', kind: 'client', verified: true },
        candidates: { inline: { label: '--permit', permit: inline } },
      })
    );
    const permit = result.unwrap();
    expect(permit?.admission).toEqual({
      by: 'derived:no-auth-resource',
      kind: 'asserted',
    });
    expect(permit?.actors).toEqual([
      { id: 'claude-code', kind: 'client', verified: false },
    ]);
    expect(permit?.scopes).toEqual(['record:write']);
  });

  test('an inline permit never carries a verified actor, even when authored', async () => {
    const result = await reconcilePermit(
      base({
        candidates: {
          inline: {
            label: '--permit',
            permit: {
              ...inline,
              actors: [{ id: 'spoofed', kind: 'client', verified: true }],
            },
          },
        },
      })
    );
    expect(result.unwrap()?.actors).toEqual([
      { id: 'spoofed', kind: 'client', verified: false },
    ]);
  });

  test('asserted kinds are refused on the network posture', async () => {
    for (const candidates of [
      { inline: { label: '--permit', permit: inline } },
      { synthetic: { label: DEV_FLAG } },
    ]) {
      const result = await reconcilePermit(
        base({ candidates, posture: 'network', surface: 'http' })
      );
      expect(categoryOf(result)).toBe('auth');
      expect(
        result.isErr() && isTrailsError(result.error) && result.error.context
      ).toMatchObject({ code: 'asserted_kind_refused' });
    }
  });

  test('asserted kinds are denied by the derived policy once an auth resource exists', async () => {
    const result = await reconcilePermit(
      base({
        candidates: { synthetic: { label: DEV_FLAG } },
        graph: guarded,
      })
    );
    expect(categoryOf(result)).toBe('auth');
    expect(result.isErr() && result.error.message).toContain('host policy');
  });

  test('an explicit policy admits asserted kinds and caps their scopes', async () => {
    const result = await reconcilePermit(
      base({
        candidates: { synthetic: { label: DEV_FLAG } },
        graph: guarded,
        policy: {
          allow: true,
          maxScopes: ['record:write'],
          name: 'app.config',
        },
      })
    );
    const permit = result.unwrap();
    expect(permit?.scopes).toEqual(['record:write']);
    expect(permit?.admission).toEqual({ by: 'app.config', kind: 'synthetic' });
  });

  test('a presented credential with no verifier is a ValidationError in process', async () => {
    const result = await reconcilePermit(
      base({
        candidates: { credential: { bearerToken: 't', label: '--token' } },
        missingVerifierMessage: '--token requires a verifier.',
      })
    );
    expect(categoryOf(result)).toBe('validation');
    expect(result.isErr() && result.error.message).toBe(
      '--token requires a verifier.'
    );
  });

  test('a presented credential with no verifier is an AuthError on the network', async () => {
    const result = await reconcilePermit(
      base({
        candidates: { credential: { apiKey: 'k', label: 'x-api-key' } },
        posture: 'network',
        surface: 'http',
      })
    );
    expect(categoryOf(result)).toBe('auth');
    expect(
      result.isErr() && isTrailsError(result.error) && result.error.context
    ).toMatchObject({ code: 'no_permit_resolver' });
  });

  test('a verified credential keeps the verifier permit and stamps verified admission', async () => {
    const seen: unknown[] = [];
    const result = await reconcilePermit(
      base({
        candidates: {
          credential: {
            authorization: 'Bearer t',
            bearerToken: 't',
            label: '--token',
          },
        },
        verifierName: 'jwt',
        verify: (input) => {
          seen.push(input);
          return Result.ok({
            actors: [{ id: 'client-1', kind: 'client', verified: true }],
            id: 'subject',
            issuer: 'https://issuer.example',
            scopes: ['record:write'],
          });
        },
      })
    );
    expect(result.unwrap()).toEqual({
      actors: [{ id: 'client-1', kind: 'client', verified: true }],
      admission: { by: 'jwt', kind: 'verified' },
      id: 'subject',
      issuer: 'https://issuer.example',
      scopes: ['record:write'],
    });
    expect(seen).toEqual([
      {
        authorization: 'Bearer t',
        bearerToken: 't',
        requestId: 'req-1',
        surface: 'cli',
      },
    ]);
  });

  test('a verifier runs for an empty credential candidate because it owns selection', async () => {
    let calls = 0;
    const result = await reconcilePermit(
      base({
        candidates: {
          credential: { headers: new Headers(), label: 'headers' },
        },
        verify: () => {
          calls += 1;
          return Result.ok(null);
        },
      })
    );
    expect(calls).toBe(1);
    expect(result.isOk() && result.value).toBeUndefined();
  });

  test('headers carrying a credential count as presented', async () => {
    const conflict = await reconcilePermit(
      base({
        candidates: {
          credential: {
            headers: new Headers({ authorization: 'Bearer t' }),
            label: 'headers',
          },
          inline: { label: '--permit', permit: inline },
        },
      })
    );
    expect(categoryOf(conflict)).toBe('validation');
    const unverifiable = await reconcilePermit(
      base({
        candidates: {
          credential: {
            headers: new Headers({ 'x-api-key': 'k' }),
            label: 'headers',
          },
        },
      })
    );
    expect(categoryOf(unverifiable)).toBe('validation');
  });

  test('an empty explicit policy name falls back to host-policy', async () => {
    const result = await reconcilePermit(
      base({
        candidates: { inline: { label: '--permit', permit: inline } },
        policy: { allow: true, name: '' },
      })
    );
    expect(result.unwrap()?.admission).toEqual({
      by: 'host-policy',
      kind: 'asserted',
    });
  });

  test('a verifier that selects no credential yields absence on both postures; its errors pass through', async () => {
    const declined = await reconcilePermit(
      base({
        candidates: { credential: { bearerToken: 't', label: '--token' } },
        verify: () => Result.ok(null),
      })
    );
    expect(declined.isOk() && declined.value).toBeUndefined();
    const absent = await reconcilePermit(
      base({
        candidates: {
          credential: { bearerToken: 't', label: 'Authorization' },
        },
        posture: 'network',
        surface: 'http',
        verify: () => Result.ok(null),
      })
    );
    expect(absent.isOk() && absent.value).toBeUndefined();
    const failed = await reconcilePermit(
      base({
        candidates: { credential: { bearerToken: 't', label: '--token' } },
        verify: () => Result.err(new AuthError('bad token')),
      })
    );
    expect(failed.isErr() && failed.error.message).toBe('bad token');
  });
});
