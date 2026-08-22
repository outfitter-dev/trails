import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const RULE_NAME = 'workspace-lock-ownership';

const checkProject = (context: ProjectContext): readonly WardenDiagnostic[] =>
  (context.unownedWorkspaceLocks ?? []).map((observation) => ({
    code: observation.kind,
    filePath: observation.path,
    line: 1,
    message: `${observation.path} is ${
      observation.kind === 'forbidden-workspace-aggregate'
        ? 'a forbidden workspace-root aggregate lock'
        : 'a nested lock outside configured app ownership'
    } (provenance: ${observation.provenance}). ${observation.coaching}`,
    rule: RULE_NAME,
    severity:
      observation.kind === 'forbidden-workspace-aggregate'
        ? ('error' as const)
        : ('warn' as const),
  }));

export const workspaceLockOwnership: ProjectAwareWardenRule = {
  check: () => [],
  checkProject,
  checkWithContext: () => [],
  description:
    'Nested locks outside configured app ownership warn, while workspace-root aggregate locks error.',
  name: RULE_NAME,
  severity: 'warn',
};
