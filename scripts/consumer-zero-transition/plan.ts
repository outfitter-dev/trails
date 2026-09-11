import { planManifestSpecifiers } from './specifiers.ts';
import type {
  ConsumerTransitionPlan,
  TransitionChange,
  TransitionDiagnostic,
} from './types.ts';
import { discoverConsumerWorkspace } from './workspaces.ts';

export const planConsumerTransition = ({
  consumerRoot,
  trailsRoot,
}: {
  readonly consumerRoot: string;
  readonly trailsRoot: string;
}): ConsumerTransitionPlan => {
  const workspace = discoverConsumerWorkspace({ consumerRoot, trailsRoot });
  const changes: TransitionChange[] = [...workspace.changes];
  const diagnostics: TransitionDiagnostic[] = [...workspace.diagnostics];
  for (const document of workspace.documents) {
    const plan = planManifestSpecifiers({
      file: document.file,
      isRoot: document === workspace.rootDocument,
      localPackages: workspace.localPackages,
      manifest: document.manifest,
      publicPackages: workspace.publicPackages,
    });
    changes.push(...plan.changes);
    diagnostics.push(...plan.diagnostics);
  }
  const changedFiles = new Set(changes.map(({ file }) => file));
  return {
    changes,
    diagnostics,
    updates: workspace.documents
      .filter(({ file }) => changedFiles.has(file))
      .flatMap((document) => {
        const after = `${JSON.stringify(document.manifest, null, 2)}\n`;
        return after === document.before
          ? []
          : [{ after, before: document.before, path: document.file }];
      }),
  };
};
