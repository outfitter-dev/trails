/**
 * `incomplete-accessor-for-standard-op` — flag standard-op CRUD trails whose
 * backing resource accessor is missing the method the trail will call at
 * runtime.
 *
 * The warden cannot invoke blazes directly, but most resources declare a
 * `mock` factory that returns a structurally real accessor for testing. We
 * exploit that: invoke the mock with no arguments, look up the accessor by
 * contour name (which equals every CRUD-emitted trail ID's leading
 * segments), and inspect the method keys.
 *
 * The rule is intentionally forgiving — if the mock factory is missing,
 * throws, or the connection shape does not match what we expect, we skip
 * the trail rather than produce a false positive. The runtime fallback in
 * `derive-trail.ts` still surfaces genuine misuse at execution time.
 */

import type { AnyResource, AnyTrail, Topo } from '@ontrails/core';
import { crudAccessorExpectations, crudOperations } from '@ontrails/store';
import type { CrudAccessorExpectation, CrudOperation } from '@ontrails/store';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

type StandardOp = CrudOperation;

const STANDARD_OPS: ReadonlySet<StandardOp> = new Set(crudOperations);

const RULE_NAME = 'incomplete-accessor-for-standard-op';

const deriveOperation = (trailId: string): StandardOp | undefined => {
  const lastDot = trailId.lastIndexOf('.');
  if (lastDot === -1) {
    return undefined;
  }
  const tail = trailId.slice(lastDot + 1);
  return STANDARD_OPS.has(tail as StandardOp)
    ? (tail as StandardOp)
    : undefined;
};

const deriveContourName = (trailId: string): string | undefined => {
  const lastDot = trailId.lastIndexOf('.');
  if (lastDot <= 0) {
    return undefined;
  }
  return trailId.slice(0, lastDot);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return typeof (value as { then?: unknown }).then !== 'function';
};

const collectMethodNames = (
  accessor: Record<string, unknown>
): ReadonlySet<string> => {
  const methods = new Set<string>();
  let current: object | null = accessor;
  while (current !== null && current !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        descriptor !== undefined &&
        'value' in descriptor &&
        typeof descriptor.value === 'function'
      ) {
        methods.add(key);
      }
    }
    current = Object.getPrototypeOf(current);
  }
  return methods;
};

const invokeMockSafely = async (
  resource: AnyResource
): Promise<unknown | undefined> => {
  const { mock } = resource;
  if (typeof mock !== 'function') {
    return undefined;
  }
  try {
    return await mock();
  } catch {
    return undefined;
  }
};

const disposeMockConnection = async (
  resource: AnyResource,
  connection: unknown
): Promise<void> => {
  const { dispose } = resource;
  if (typeof dispose !== 'function') {
    return;
  }
  try {
    await dispose(connection);
  } catch {
    // Cleanup failures should not turn best-effort inspection into a false positive.
  }
};

const resolveAccessor = (
  connection: unknown,
  contourName: string
): Record<string, unknown> | undefined => {
  if (!isPlainObject(connection)) {
    return undefined;
  }
  const accessor = connection[contourName];
  return isPlainObject(accessor) ? accessor : undefined;
};

/**
 * Attempt to resolve the accessor shape from the resource's mock factory.
 *
 * Returns `undefined` when the accessor cannot be inspected (no mock, mock
 * throws, connection doesn't have the expected key, etc.). The rule treats
 * `undefined` as "skip this trail" rather than as a violation — we should
 * never false-positive on a shape we cannot see.
 */
const inspectAccessorMethods = async (
  resource: AnyResource,
  contourName: string
): Promise<ReadonlySet<string> | undefined> => {
  const connection = await invokeMockSafely(resource);
  if (connection === undefined) {
    return undefined;
  }
  try {
    const accessor = resolveAccessor(connection, contourName);
    if (accessor === undefined) {
      return undefined;
    }
    return collectMethodNames(accessor);
  } finally {
    await disposeMockConnection(resource, connection);
  }
};

const formatDiagnostic = (
  trailId: string,
  operation: StandardOp,
  message: string,
  severity: 'warn' | 'error'
): WardenDiagnostic => ({
  filePath: '<topo>',
  line: 1,
  message: `Trail "${trailId}" (crud.${operation}): ${message}`,
  rule: RULE_NAME,
  severity,
});

interface StandardOpContext {
  readonly trailId: string;
  readonly operation: StandardOp;
  readonly contourName: string;
  readonly resource: AnyResource;
}

// CRUD trails synthesized by the store factory always declare one resource.
// For multi- or zero-resource trails, we cannot unambiguously pick one to
// inspect; skip rather than guess.
const extractSoleResource = (trail: AnyTrail): AnyResource | undefined => {
  const resources = trail.resources ?? [];
  if (resources.length !== 1) {
    return undefined;
  }
  const [resource] = resources;
  return resource;
};

const extractStandardOpContext = (
  trail: AnyTrail
): StandardOpContext | undefined => {
  if (trail.pattern !== 'crud') {
    return undefined;
  }
  const operation = deriveOperation(trail.id);
  const contourName = deriveContourName(trail.id);
  const resource = extractSoleResource(trail);
  if (
    operation === undefined ||
    contourName === undefined ||
    resource === undefined
  ) {
    return undefined;
  }
  return { contourName, operation, resource, trailId: trail.id };
};

const diagnoseMissingMethod = (
  ctx: StandardOpContext,
  methods: ReadonlySet<string>,
  expectation: CrudAccessorExpectation
): WardenDiagnostic | undefined => {
  if (methods.has(expectation.preferred)) {
    return undefined;
  }
  const { fallback } = expectation;
  const base = `resource "${ctx.resource.id}" accessor "${ctx.contourName}"`;
  if (fallback === undefined) {
    return formatDiagnostic(
      ctx.trailId,
      ctx.operation,
      `${base} is missing required method "${expectation.preferred}"`,
      expectation.severityWhenNoFallback
    );
  }
  if (methods.has(fallback)) {
    return formatDiagnostic(
      ctx.trailId,
      ctx.operation,
      `${base} is missing preferred method "${expectation.preferred}"; falls back to "${fallback}"`,
      expectation.severityWhenPreferredMissingWithFallback ??
        expectation.severityWhenNoFallback
    );
  }
  return formatDiagnostic(
    ctx.trailId,
    ctx.operation,
    `${base} is missing both "${expectation.preferred}" and fallback "${fallback}"`,
    expectation.severityWhenNoFallback
  );
};

const evaluateTrail = async (
  trail: AnyTrail
): Promise<readonly WardenDiagnostic[]> => {
  const ctx = extractStandardOpContext(trail);
  if (ctx === undefined) {
    return [];
  }
  const methods = await inspectAccessorMethods(ctx.resource, ctx.contourName);
  if (methods === undefined) {
    return [];
  }
  const diagnostic = diagnoseMissingMethod(
    ctx,
    methods,
    crudAccessorExpectations[ctx.operation]
  );
  return diagnostic === undefined ? [] : [diagnostic];
};

/**
 * Topo-aware rule that flags CRUD trails whose backing accessor is missing
 * the method invoked by the synthesized blaze.
 *
 * @remarks
 * Introspects each resource's `mock()` factory to determine the accessor
 * shape. Trails whose resource has no mock, whose mock throws, or whose
 * mock returns a shape the rule cannot interpret are silently skipped. The
 * runtime fallback in `derive-trail.ts` remains the enforcement of last
 * resort.
 */
export const incompleteAccessorForStandardOp: TopoAwareWardenRule = {
  async checkTopo(topo: Topo): Promise<readonly WardenDiagnostic[]> {
    const diagnostics: WardenDiagnostic[] = [];
    for (const trail of topo.trails.values()) {
      diagnostics.push(...(await evaluateTrail(trail)));
    }
    return diagnostics;
  },
  description:
    'Flag CRUD-pattern trails whose resource accessor lacks the method the synthesized blaze will call at runtime.',
  name: RULE_NAME,
  severity: 'error',
};
