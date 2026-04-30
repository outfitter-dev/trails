import type { Intent, Topo } from '@ontrails/core';

/**
 * Severity level for warden diagnostics.
 */
export type WardenSeverity = 'error' | 'warn';

/**
 * Execution tier for a Warden rule.
 *
 * Tier names describe the narrowest runtime shape that can answer the rule's
 * question. They do not change ownership: source-static rules can still be
 * durable public Warden doctrine.
 */
export type WardenRuleTier =
  | 'advisory'
  | 'drift'
  | 'project-static'
  | 'source-static'
  | 'topo-aware';

/**
 * Context where a Warden rule applies.
 */
export type WardenRuleScope =
  | 'advisory'
  | 'extension'
  | 'external'
  | 'internal'
  | 'repo-local'
  | 'temporary';

/**
 * Lifecycle state for a Warden rule.
 */
export type WardenRuleLifecycleState = 'deprecated' | 'durable' | 'temporary';

/**
 * Lifecycle metadata for a Warden rule.
 */
export interface WardenRuleLifecycle {
  /** Current lifecycle state. */
  readonly state: WardenRuleLifecycleState;
  /** Required for temporary or deprecated rules. */
  readonly retireWhen?: string | undefined;
}

/**
 * Stable metadata used to classify Warden rules before dispatch filtering.
 */
export interface WardenRuleMetadata {
  /** One-line invariant the rule protects. */
  readonly invariant: string;
  /** Rule lifecycle. */
  readonly lifecycle: WardenRuleLifecycle;
  /** Where the rule applies. */
  readonly scope: WardenRuleScope;
  /** Narrowest Warden tier that can answer the rule. */
  readonly tier: WardenRuleTier;
}

/**
 * A single diagnostic reported by a warden rule.
 */
export interface WardenDiagnostic {
  /** Rule identifier, e.g. "no-throw-in-implementation" */
  readonly rule: string;
  /** Severity level */
  readonly severity: WardenSeverity;
  /** Human-readable message describing the violation */
  readonly message: string;
  /** 1-based line number where the violation was detected */
  readonly line: number;
  /** File path that was analyzed */
  readonly filePath: string;
}

/**
 * A warden rule analyzes one source file and returns diagnostics.
 *
 * Rules should prefer structured AST helpers when they inspect TypeScript
 * syntax. Simple string checks remain acceptable when the authored rule is
 * explicitly about text that is not parseable syntax, such as generated output.
 */
export interface WardenRule {
  /** Unique rule identifier */
  readonly name: string;
  /** Default severity */
  readonly severity: WardenSeverity;
  /** Human-readable description of what the rule enforces */
  readonly description: string;
  /** Optional inline classification. Built-ins are classified by registry. */
  readonly metadata?: WardenRuleMetadata | undefined;
  /** Run the rule against source code and return any diagnostics */
  readonly check: (
    sourceCode: string,
    filePath: string
  ) => readonly WardenDiagnostic[];
}

/**
 * Options for cross-file rules that need knowledge of all trail IDs in a project.
 */
export interface ProjectContext {
  /** All known contour names in the project. */
  readonly knownContourIds?: ReadonlySet<string>;
  /** Store table IDs used with the CRUD factory across the project. */
  readonly crudTableIds?: ReadonlySet<string>;
  /** All known trail IDs in the project */
  readonly knownTrailIds: ReadonlySet<string>;
  /** Declared contour references keyed by source contour name. */
  readonly contourReferencesByName?: ReadonlyMap<string, readonly string[]>;
  /** All known resource IDs in the project */
  readonly knownResourceIds?: ReadonlySet<string>;
  /** All known signal IDs in the project */
  readonly knownSignalIds?: ReadonlySet<string>;
  /** All trail IDs referenced by declared crosses arrays across the project. */
  readonly crossTargetTrailIds?: ReadonlySet<string>;
  /** Signal IDs referenced by trail `on` arrays across the project. */
  readonly onTargetSignalIds?: ReadonlySet<string>;
  /** Store table IDs used with reconcile trails across the project. */
  readonly reconcileTableIds?: ReadonlySet<string>;
  /** Normalized trail intents by trail ID across the project. */
  readonly trailIntentsById?: ReadonlyMap<string, Intent>;
  /**
   * CRUD operation coverage per entity aggregated across the project.
   *
   * Keys are stable entity IDs (authored contour names, `imported:<local>`
   * sentinels for contours imported from another module, or store-table IDs
   * produced by `deriveStoreTableId`). Values are the set of CRUD operations
   * (`create`, `read`, `update`, `delete`, `list`) observed for that entity.
   *
   * Enables cross-file completeness evaluation so one-file-per-operation
   * layouts (e.g. separate `create.ts`, `read.ts`) do not trip file-scoped
   * coverage warnings.
   */
  readonly crudCoverageByEntity?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * A project-aware rule that requires knowledge of all trail IDs.
 */
export interface ProjectAwareWardenRule extends WardenRule {
  /** Run the rule with project-level context */
  readonly checkWithContext: (
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ) => readonly WardenDiagnostic[];
}

/**
 * A topo-aware warden rule inspects the compiled runtime trail graph —
 * actual `Trail` objects with resolved types, accessor shapes, detour
 * declarations, `pattern` field values, and other runtime-only data that
 * is unavailable to AST-based rules.
 *
 * Unlike `WardenRule` and `ProjectAwareWardenRule`, which analyze source
 * code on a per-file basis, a `TopoAwareWardenRule` runs once per topo
 * and returns diagnostics spanning the whole graph. A rule file must
 * implement exactly one of the three rule kinds.
 */
export interface TopoAwareWardenRule {
  /** Unique rule identifier */
  readonly name: string;
  /** Default severity */
  readonly severity: WardenSeverity;
  /** Human-readable description of what the rule enforces */
  readonly description: string;
  /** Optional inline classification. Built-ins are classified by registry. */
  readonly metadata?: WardenRuleMetadata | undefined;
  /** Run the rule against the resolved topo and return any diagnostics */
  readonly checkTopo: (
    topo: Topo
  ) => readonly WardenDiagnostic[] | Promise<readonly WardenDiagnostic[]>;
}
