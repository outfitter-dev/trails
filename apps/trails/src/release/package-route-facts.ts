import { listGovernedVocabularyTransitions } from '@ontrails/warden';

import type { WorkspaceInfo } from './check.js';

export interface PackageRouteReleaseFact {
  readonly kind: 'classified' | 'single';
  readonly sourcePackage: string;
  readonly targetPackage?: string;
  readonly transitionId: string;
}

export interface PackageRouteReleaseDiagnostic {
  readonly code:
    | 'missing-governed-package-route'
    | 'missing-governed-package-route-target';
  readonly message: string;
  readonly sourcePackage: string;
}

export interface PackageRouteReleaseIntent {
  readonly eligiblePackages: readonly string[];
  readonly sourcePackage: string;
}

const isPublishableTrailsPackage = (workspace: WorkspaceInfo): boolean =>
  !workspace.isPrivate && workspace.name.startsWith('@ontrails/');

const findPackageRouteTransition = (
  transitions: ReturnType<typeof listGovernedVocabularyTransitions>,
  sourcePackage: string
) => {
  const direct = transitions.find(
    (transition) => transition.from === sourcePackage
  );

  if (direct) {
    return { target: direct.target, transition: direct };
  }

  for (const transition of transitions) {
    const moduleSpecifierRoute = transition.stringLiteralRenames.find(
      (route) =>
        route.from === sourcePackage &&
        route.moduleSpecifier?.targetPackage !== undefined
    );

    if (moduleSpecifierRoute?.moduleSpecifier?.targetPackage) {
      return {
        target: {
          kind: 'single' as const,
          to: moduleSpecifierRoute.moduleSpecifier.targetPackage,
        },
        transition,
      };
    }
  }

  return null;
};

export const findPackageRouteReleaseFacts = ({
  baseWorkspaces,
  workspaces,
}: {
  readonly baseWorkspaces: readonly WorkspaceInfo[];
  readonly workspaces: readonly WorkspaceInfo[];
}): {
  readonly diagnostics: readonly PackageRouteReleaseDiagnostic[];
  readonly facts: readonly PackageRouteReleaseFact[];
  readonly intents: readonly PackageRouteReleaseIntent[];
} => {
  const currentPackages = new Set(
    workspaces
      .filter(isPublishableTrailsPackage)
      .map((workspace) => workspace.name)
  );
  const removedPackages = baseWorkspaces
    .filter(isPublishableTrailsPackage)
    .map((workspace) => workspace.name)
    .filter((name) => !currentPackages.has(name))
    .toSorted();
  const transitions = listGovernedVocabularyTransitions();
  const diagnostics: PackageRouteReleaseDiagnostic[] = [];
  const facts: PackageRouteReleaseFact[] = [];
  const intents: PackageRouteReleaseIntent[] = [];

  for (const sourcePackage of removedPackages) {
    const resolvedRoute = findPackageRouteTransition(
      transitions,
      sourcePackage
    );

    if (!resolvedRoute) {
      diagnostics.push({
        code: 'missing-governed-package-route',
        message: `Public package removal '${sourcePackage}' requires an exact governed Regrade route. Add the route to the governed transition registry, then run trails regrade plan/check.`,
        sourcePackage,
      });
      continue;
    }

    const { target, transition } = resolvedRoute;

    if (target.kind === 'classified') {
      const classifiedTarget = target;
      const eligiblePackages = [...currentPackages]
        .filter((packageName) =>
          classifiedTarget.options.some(
            (option) =>
              option.to === packageName ||
              option.to.startsWith(`${packageName}/`)
          )
        )
        .toSorted();
      facts.push({
        kind: 'classified',
        sourcePackage,
        transitionId: transition.id,
      });
      intents.push({ eligiblePackages, sourcePackage });
      continue;
    }

    if (!currentPackages.has(target.to)) {
      diagnostics.push({
        code: 'missing-governed-package-route-target',
        message: `Governed Regrade route '${transition.id}' maps '${sourcePackage}' to '${target.to}', but that publishable target package is absent. Add the target package before applying the route, or use a classified transition with an explicit non-migratable reason for a multi-owner fold.`,
        sourcePackage,
      });
      continue;
    }

    facts.push({
      kind: 'single',
      sourcePackage,
      targetPackage: target.to,
      transitionId: transition.id,
    });
    intents.push({
      eligiblePackages: [target.to],
      sourcePackage,
    });
  }

  return { diagnostics, facts, intents };
};
