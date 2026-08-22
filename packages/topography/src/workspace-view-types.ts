import type { PathScope } from '@ontrails/core';
import type { ReadTrailsProjectIdentityResult } from '@ontrails/config';

import type { TopoGraph, TopoGraphEntry } from './types.js';

/** Version of the canonical workspace-view hash contract. */
export const WORKSPACE_VIEW_SCHEMA_VERSION = 1 as const;

/** One Config-owned app and its complete saved graph. */
export interface WorkspaceViewApp {
  readonly id: string;
  readonly root: string;
  readonly topoGraph: TopoGraph;
  readonly topoGraphHash: string;
}

/** One graph identity owned by more than one configured app. */
export interface WorkspaceViewCollision {
  readonly appIds: readonly string[];
  readonly id: string;
  readonly kind: TopoGraphEntry['kind'];
}

/** Canonical graph content. Machine-local observation facts do not enter it. */
export interface WorkspaceViewContent {
  readonly apps: readonly WorkspaceViewApp[];
  readonly collisions: readonly WorkspaceViewCollision[];
  readonly workspaceViewSchemaVersion: typeof WORKSPACE_VIEW_SCHEMA_VERSION;
}

export type WorkspaceAppLockStatus =
  | 'available'
  | 'invalid'
  | 'missing'
  | 'unavailable';
export type WorkspaceAppLockBinding = 'matched' | 'mismatched' | 'unavailable';
export type WorkspaceAppLockFreshness =
  | 'fresh'
  | 'stale'
  | 'unknown'
  | 'unavailable';

/** Evidence for one configured app's expected app-local lock. */
export interface WorkspaceAppLockObservation {
  readonly actualAppId?: string | undefined;
  readonly binding: WorkspaceAppLockBinding;
  readonly coaching?: string | undefined;
  readonly detail?: string | undefined;
  readonly freshness: WorkspaceAppLockFreshness;
  readonly id: string;
  readonly lockPath: string;
  readonly provenance: 'configured-app-lock';
  readonly root: string;
  readonly selected: boolean;
  readonly status: WorkspaceAppLockStatus;
}

/** A lock found inside the collection but not owned by `workspace.apps`. */
export interface UnownedWorkspaceLockObservation {
  readonly coaching: string;
  readonly kind: 'forbidden-workspace-aggregate' | 'unconfigured-app-lock';
  readonly path: string;
  readonly provenance: 'source-collection';
}

/** A collection edge or policy skip observed while performing the lock census. */
export interface WorkspaceViewCollectionSkip {
  readonly path: string;
  readonly provenance: 'source-collection';
  readonly reason: string;
}

/** Non-canonical evidence about the current workspace observation. */
export interface WorkspaceViewEvidence {
  readonly apps: readonly WorkspaceAppLockObservation[];
  readonly collectionSkips: readonly WorkspaceViewCollectionSkip[];
  readonly configuredAppIds: readonly string[];
  readonly configuredCompleteness: 'complete' | 'partial';
  readonly selectedAppIds: readonly string[];
  readonly selectedCompleteness: 'complete' | 'partial';
  readonly unownedLocks: readonly UnownedWorkspaceLockObservation[];
}

/** One canonical app-partitioned graph view plus current observation evidence. */
export interface WorkspaceView {
  readonly content: WorkspaceViewContent;
  readonly evidence: WorkspaceViewEvidence;
  /** Null when a missing, invalid, or contradictory lock makes content partial. */
  readonly workspaceViewHash: string | null;
}

export interface DeriveWorkspaceViewOptions {
  /** Config-owned workspace identity returned by `readTrailsProjectIdentity()`. */
  readonly identity: ReadTrailsProjectIdentityResult;
  /**
   * Optional current graph hashes used to prove freshness. An omitted app stays
   * `unknown`; lock integrity is always verified independently.
   */
  readonly currentAppGraphHashes?: Readonly<Record<string, string>> | undefined;
  /** Scope for the observation-only lock census. */
  readonly lockScope?: PathScope | undefined;
  /** Configured app IDs selected by the caller. Defaults to every app. */
  readonly selectedAppIds?: readonly string[] | undefined;
}
