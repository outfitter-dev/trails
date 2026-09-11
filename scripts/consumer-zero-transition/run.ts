import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { planConsumerTransition } from './plan.ts';
import type { ConsumerTransitionPlan, TransitionChange } from './types.ts';
import { TARGET_VERSION } from './types.ts';

export type InstallRunner = (consumerRoot: string) => number;

export interface ConsumerTransitionResult {
  readonly code: number;
  readonly lines: readonly string[];
  readonly plan?: ConsumerTransitionPlan;
}

const defaultInstallRunner: InstallRunner = (consumerRoot) =>
  Bun.spawnSync({
    cmd: ['bun', 'install'],
    cwd: consumerRoot,
    stderr: 'inherit',
    stdout: 'inherit',
  }).exitCode;

const describeChange = (
  change: TransitionChange,
  consumerRoot: string
): string => {
  const file = relative(consumerRoot, change.file).replaceAll('\\', '/');
  return change.kind === 'remove'
    ? `remove ${file} ${change.field}.${change.name} (${change.from})`
    : `replace ${file} ${change.field}.${change.name}: ${change.from} -> ${change.to}`;
};

const describeInstallResult = (
  installCode: number,
  manifestsChanged: boolean
): string => {
  if (installCode === 0) {
    return manifestsChanged
      ? 'Manifests and bun.lock updated with `bun install`.'
      : 'No manifest changes needed. Ran `bun install` to update bun.lock.';
  }
  return manifestsChanged
    ? `Manifests were updated, but \`bun install\` exited ${installCode}.`
    : `No manifest changes were needed, but \`bun install\` exited ${installCode}.`;
};

export const applyConsumerTransitionPlan = (
  plan: ConsumerTransitionPlan
): string | undefined => {
  const changedDuringPlan = plan.updates.find(
    (update) => readFileSync(update.path, 'utf8') !== update.before
  )?.path;
  if (changedDuringPlan) {
    return changedDuringPlan;
  }
  for (const update of plan.updates) {
    writeFileSync(update.path, update.after);
  }
  return undefined;
};

export const executeConsumerTransition = ({
  apply,
  consumerRoot,
  install,
  installRunner = defaultInstallRunner,
  trailsRoot,
}: {
  readonly apply: boolean;
  readonly consumerRoot: string;
  readonly install: boolean;
  readonly installRunner?: InstallRunner;
  readonly trailsRoot: string;
}): ConsumerTransitionResult => {
  if (install && !apply) {
    return { code: 2, lines: ['--install requires --apply.'] };
  }

  let plan: ConsumerTransitionPlan;
  try {
    plan = planConsumerTransition({ consumerRoot, trailsRoot });
  } catch (error) {
    return {
      code: 1,
      lines: [error instanceof Error ? error.message : String(error)],
    };
  }

  const root = resolve(consumerRoot);
  const lines = [
    `Trails consumer transition target: ${TARGET_VERSION}`,
    ...plan.changes.map((change) => describeChange(change, root)),
    ...plan.diagnostics.map(
      (diagnostic) =>
        `blocked ${relative(root, diagnostic.file)}: ${diagnostic.message}`
    ),
  ];
  if (plan.diagnostics.length > 0) {
    return { code: 1, lines, plan };
  }
  if (!apply) {
    return {
      code: 0,
      lines: [
        ...lines,
        plan.changes.length === 0
          ? 'No 1.0-line Trails declarations found.'
          : 'Preview only. Re-run with --apply to write these manifests.',
      ],
      plan,
    };
  }
  if (plan.updates.length === 0 && !install) {
    return { code: 0, lines: [...lines, 'No manifest changes needed.'], plan };
  }

  const changedDuringPlan = applyConsumerTransitionPlan(plan);
  if (changedDuringPlan) {
    return {
      code: 1,
      lines: [
        ...lines,
        `Refusing to write because ${changedDuringPlan} changed after planning.`,
      ],
      plan,
    };
  }
  if (!install) {
    return {
      code: 0,
      lines: [
        ...lines,
        'Manifests updated. Run `bun install` in the consumer root.',
      ],
      plan,
    };
  }
  const installCode = installRunner(root);
  return {
    code: installCode,
    lines: [
      ...lines,
      describeInstallResult(installCode, plan.updates.length > 0),
    ],
    plan,
  };
};
