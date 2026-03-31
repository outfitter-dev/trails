import type { Trail } from '@ontrails/core';

// ---------------------------------------------------------------------------
// Diagnostic type
// ---------------------------------------------------------------------------

/** A single governance finding from a permit rule. */
export interface PermitDiagnostic {
  readonly trailId: string;
  readonly rule: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyTrail = Trail<unknown, unknown>;
type Rule = (trails: readonly AnyTrail[]) => readonly PermitDiagnostic[];

/** Check whether a trail has any permit declaration (scopes object or 'public'). */
const hasPermit = (t: AnyTrail): boolean => t.permit !== undefined;

/** Extract scopes from a trail's permit declaration, or empty array. */
const getScopes = (t: AnyTrail): readonly string[] => {
  if (t.permit !== undefined && t.permit !== 'public') {
    return t.permit.scopes;
  }
  return [];
};

// ---------------------------------------------------------------------------
// Rule: destroyWithoutPermit
// ---------------------------------------------------------------------------

/**
 * Destructive trails without a real permit declaration are a governance failure.
 *
 * Reports an error for every trail with `intent: 'destroy'` that has no
 * `permit` field or explicitly opts out with `permit: 'public'`.
 */
export const destroyWithoutPermit: Rule = (trails) =>
  trails
    .filter(
      (t) => t.intent === 'destroy' && (!hasPermit(t) || t.permit === 'public')
    )
    .map((t) => ({
      message: `Trail "${t.id}" has intent 'destroy' but no permit declaration`,
      rule: 'destroyWithoutPermit',
      severity: 'error' as const,
      trailId: t.id,
    }));

// ---------------------------------------------------------------------------
// Rule: writeWithoutPermit
// ---------------------------------------------------------------------------

/**
 * Write trails without a permit declaration get a warning.
 *
 * Trails with `intent: 'write'` (or no intent, which defaults to write) that
 * lack a permit are flagged unless `permit: 'public'` is explicitly set.
 */
export const writeWithoutPermit: Rule = (trails) =>
  trails
    .filter(
      (t) => (t.intent === 'write' || t.intent === undefined) && !hasPermit(t)
    )
    .map((t) => ({
      message: `Trail "${t.id}" has write intent but no permit declaration`,
      rule: 'writeWithoutPermit',
      severity: 'warning' as const,
      trailId: t.id,
    }));

// ---------------------------------------------------------------------------
// Rule: scopeNamingConsistency
// ---------------------------------------------------------------------------

/** Returns true when a scope follows the `entity:action` convention. */
const isValidScopeFormat = (scope: string): boolean => {
  const parts = scope.split(':');
  return (
    parts.length === 2 &&
    (parts[0]?.length ?? 0) > 0 &&
    (parts[1]?.length ?? 0) > 0
  );
};

/**
 * Warns for scopes that don't follow the `entity:action` convention.
 *
 * A valid scope contains exactly one colon separating a non-empty entity
 * and a non-empty action.
 */
export const scopeNamingConsistency: Rule = (trails) =>
  trails.flatMap((t) =>
    getScopes(t)
      .filter((scope) => !isValidScopeFormat(scope))
      .map((scope) => ({
        message: `Scope "${scope}" on trail "${t.id}" does not follow entity:action convention`,
        rule: 'scopeNamingConsistency',
        severity: 'warning' as const,
        trailId: t.id,
      }))
  );

// ---------------------------------------------------------------------------
// Rule: orphanScopeDetection
// ---------------------------------------------------------------------------

/** Build a map of scope -> set of trail IDs that declare it. */
const buildScopeMap = (
  trails: readonly AnyTrail[]
): ReadonlyMap<string, ReadonlySet<string>> => {
  const map = new Map<string, Set<string>>();
  for (const t of trails) {
    for (const scope of getScopes(t)) {
      const existing = map.get(scope);
      if (existing) {
        existing.add(t.id);
      } else {
        map.set(scope, new Set([t.id]));
      }
    }
  }
  return map;
};

/** Filter trails that have a scoped (non-public) permit declaration. */
const trailsWithScopedPermit = (
  trails: readonly AnyTrail[]
): readonly AnyTrail[] =>
  trails.filter((t) => t.permit !== undefined && t.permit !== 'public');

/** Convert orphan scope map entries into diagnostics. */
const orphanDiagnostics = (
  scopeMap: ReadonlyMap<string, ReadonlySet<string>>
): readonly PermitDiagnostic[] =>
  [...scopeMap.entries()]
    .filter(([, ids]) => ids.size === 1)
    .map(([scope, ids]) => ({
      message: `Scope "${scope}" appears only on trail "${[...ids][0]}" — possible typo`,
      rule: 'orphanScopeDetection',
      severity: 'warning' as const,
      trailId: [...ids][0] ?? '',
    }));

/**
 * Warns for scopes that appear in only one trail's permit.
 *
 * Catches typos like `user:wirte` by surfacing scopes not shared with any
 * other trail. Only runs when at least 2 trails have permit declarations.
 */
export const orphanScopeDetection: Rule = (trails) => {
  const scoped = trailsWithScopedPermit(trails);
  if (scoped.length < 2) {
    return [];
  }
  return orphanDiagnostics(buildScopeMap(scoped));
};

// ---------------------------------------------------------------------------
// Top-level validator
// ---------------------------------------------------------------------------

const allRules: readonly Rule[] = [
  destroyWithoutPermit,
  writeWithoutPermit,
  scopeNamingConsistency,
  orphanScopeDetection,
];

/**
 * Run all permit governance rules against a set of trails.
 *
 * Returns a flat array of diagnostics from every rule. An empty array
 * means the topo passes all permit governance checks.
 */
export const validatePermits = (
  trails: readonly Trail<unknown, unknown>[]
): readonly PermitDiagnostic[] => allRules.flatMap((rule) => rule(trails));
