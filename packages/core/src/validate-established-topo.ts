import { ValidationError } from './errors.js';
import { Result } from './result.js';
import type { Topo } from './topo.js';
import { validateDraftFreeTopo } from './draft.js';
import type { TopoDiagnostic } from './validate-topo.js';
import { validateTopo } from './validate-topo.js';

const DERIVATION_BLOCKING_RULES = new Set([
  'compose-cycle',
  'compose-exists',
  'no-self-compose',
  'activation-source-definition-unique',
  'activation-source-edge-unique',
  'activation-source-kind-known',
  'activation-queue-valid',
  'activation-schedule-valid',
  'resource-exists',
  'signal-fire-exists',
  'signal-on-exists',
  'signal-origin-exists',
]);

const isDerivationBlockingIssue = (issue: TopoDiagnostic): boolean =>
  DERIVATION_BLOCKING_RULES.has(issue.rule) ||
  (issue.rule === 'activation-source-input-compatible' &&
    issue.sourceKind === 'queue');

const keepDerivationBlockingIssues = (
  result: ReturnType<typeof validateTopo>
) => {
  if (result.isOk()) {
    return result;
  }

  const issues = (
    result.error.context as { issues?: readonly TopoDiagnostic[] } | undefined
  )?.issues;
  const remainingIssues = issues?.filter(isDerivationBlockingIssue);

  if (remainingIssues === undefined || remainingIssues.length === 0) {
    return Result.ok();
  }

  return Result.err(
    new ValidationError(
      `Topo validation failed with ${remainingIssues.length} issue(s)`,
      {
        cause: result.error,
        context: { issues: remainingIssues },
      }
    )
  );
};

/**
 * Validate that a topo is ready for established outputs.
 *
 * Established surfaces still require the authored graph to be structurally
 * valid, and they must also reject any remaining draft state.
 */
export const validateEstablishedTopo = (topo: Topo) => {
  const structural = keepDerivationBlockingIssues(validateTopo(topo));
  if (structural.isErr()) {
    return structural;
  }

  const established = validateDraftFreeTopo(topo);
  if (established.isErr()) {
    return established;
  }

  return Result.ok();
};
