import { ValidationError } from './errors.js';
import { Result } from './result.js';
import type { Topo } from './topo.js';
import { validateEstablishedTopo as validateDraftFreeTopo } from './draft.js';
import type { TopoIssue } from './validate-topo.js';
import { validateTopo } from './validate-topo.js';

const PROJECTION_BLOCKING_RULES = new Set([
  'cross-cycle',
  'cross-exists',
  'no-self-cross',
  'resource-exists',
  'signal-origin-exists',
]);

const keepProjectionBlockingIssues = (
  result: ReturnType<typeof validateTopo>
) => {
  if (result.isOk()) {
    return result;
  }

  const issues = (
    result.error.context as { issues?: readonly TopoIssue[] } | undefined
  )?.issues;
  const remainingIssues = issues?.filter((issue) =>
    PROJECTION_BLOCKING_RULES.has(issue.rule)
  );

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
  const structural = keepProjectionBlockingIssues(validateTopo(topo));
  if (structural.isErr()) {
    return structural;
  }

  const established = validateDraftFreeTopo(topo);
  if (established.isErr()) {
    return established;
  }

  return Result.ok();
};
