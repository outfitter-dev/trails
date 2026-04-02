import { Result } from '@ontrails/core';
import type { Gate } from '@ontrails/core';

import { PermitError } from './errors.js';
import { getPermit } from './permit.js';

// ---------------------------------------------------------------------------
// Helpers (defined before callers — no use-before-define)
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the permit requirement means "no enforcement needed."
 * Either the trail hasn't declared a permit posture or has explicitly
 * opted out with `'public'`.
 */
const isPassThrough = (
  requirement: unknown
): requirement is undefined | 'public' =>
  requirement === undefined || requirement === 'public';

/** Returns scopes present in `required` but absent from `held`. */
const findMissing = (
  required: readonly string[],
  held: readonly string[]
): readonly string[] => required.filter((s) => !held.includes(s));

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

/**
 * A {@link Gate} that enforces permit scopes declared on trails.
 *
 * The gate reads the trail's `permit` field (a `PermitRequirement`):
 *
 * - If `permit` is `'public'` or `undefined` the gate passes through.
 * - If `permit` has `scopes`, the gate checks that `ctx.permit` contains
 *   all required scopes. A superset is fine; missing scopes produce a
 *   `PermitError`.
 *
 * Because `ctx.cross()` re-enters `executeTrail` (which applies gates),
 * this gate automatically re-checks on every invocation in a crossing chain.
 * No special crossing-chain handling is needed — it is built into the
 * architecture.
 */
export const authGate: Gate = {
  description: 'Enforces permit scopes declared on trails',
  name: 'auth',
  wrap: (_trail, impl) => {
    const requirement = _trail.permit;

    if (isPassThrough(requirement)) {
      return impl;
    }

    return (input, ctx) => {
      const permit = getPermit(ctx);

      if (!permit) {
        return Promise.resolve(
          Result.err(new PermitError('No permit provided'))
        );
      }

      const missing = findMissing(requirement.scopes, permit.scopes);

      if (missing.length > 0) {
        return Promise.resolve(
          Result.err(
            new PermitError(`Missing scopes: ${missing.join(', ')}`, {
              context: { missing, required: requirement.scopes },
            })
          )
        );
      }

      return Promise.resolve(impl(input, ctx));
    };
  },
};
