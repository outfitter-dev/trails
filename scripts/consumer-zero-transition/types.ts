export const TARGET_VERSION = '0.2.0';

export type DependencyField =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies';

export interface TransitionChange {
  readonly field: string;
  readonly file: string;
  readonly from: string;
  readonly kind: 'remove' | 'replace';
  readonly name: string;
  readonly to?: string;
}

export interface TransitionDiagnostic {
  readonly file: string;
  readonly message: string;
  readonly name?: string;
}

export interface ManifestUpdate {
  readonly after: string;
  readonly before: string;
  readonly path: string;
}

export interface ConsumerTransitionPlan {
  readonly changes: readonly TransitionChange[];
  readonly diagnostics: readonly TransitionDiagnostic[];
  readonly updates: readonly ManifestUpdate[];
}
