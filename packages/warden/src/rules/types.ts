import type {
  DiagnosticSeverity,
  Intent,
  RuleDiagnosticBase,
  ScanTargets,
  Topo,
} from '@ontrails/core';
import type { TopoGraph } from '@ontrails/topographer';

import type { WardenDepth } from '../config.js';
import type { WardenImportResolution } from '../resolve.js';
import type { WardenPublicWorkspace } from '../workspaces.js';

/**
 * Severity level for warden diagnostics.
 */
export type WardenSeverity = DiagnosticSeverity;

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
 * Queryable concern dimension for Warden rule metadata.
 */
export type WardenRuleConcern =
  | 'composition'
  | 'general'
  | 'lifecycle'
  | 'meta'
  | 'permits'
  | 'resources'
  | 'results'
  | 'signals';

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
 * Documentation or reference target for Warden remediation guidance.
 */
export interface WardenGuidanceLink {
  /** Human-readable link label. */
  readonly label: string;
  /** Repository-relative documentation path, when the target is in-tree. */
  readonly path?: string | undefined;
  /** External documentation URL, when the target is outside the repo. */
  readonly url?: string | undefined;
}

/**
 * Structured remediation guidance that can be rendered for humans or projected
 * into agent-facing manifests without scraping diagnostic prose.
 */
export interface WardenGuidance {
  /** Concise next step for the finding or rule. */
  readonly summary: string;
  /** Ordered remediation steps, when the rule benefits from more detail. */
  readonly steps?: readonly string[] | undefined;
  /** Reference docs that explain the invariant. */
  readonly docs?: readonly WardenGuidanceLink[] | undefined;
  /** Example commands. These are guidance examples, not autofix contracts. */
  readonly commands?: readonly string[] | undefined;
  /** Related rule identifiers that help agents navigate nearby doctrine. */
  readonly relatedRules?: readonly string[] | undefined;
}

/**
 * Transform class a fix belongs to.
 *
 * Names the kind of mechanical change so agents, the guide, and downstream
 * regrades can route by class. `term-rewrite` is the durable name for retired
 * vocabulary renames (`vocab-cutover` is historical wording only).
 */
export type WardenFixClass = 'term-rewrite';

/**
 * How safe a fix is to apply without human review.
 *
 * - `safe`: a deterministic, scope-correct source edit `warden --fix` may apply
 *   automatically.
 * - `review`: the change is understood but needs human judgement (ambiguous
 *   span, removal with no mechanical replacement, semantic follow-up). The
 *   finding stays reported; `warden --fix` never applies it.
 */
export type WardenFixSafety = 'review' | 'safe';

/**
 * A concrete, half-open source edit `[start, end)` replaced by `replacement`.
 *
 * Offsets are JavaScript string indices into the exact analyzed source text,
 * matching `String.prototype.slice()` and the `offsetToLine` helper the rules
 * already use. Carrying an explicit span (not just a line) lets `warden --fix`
 * apply edits deterministically and
 * last-to-first without re-parsing.
 */
export interface WardenFixEdit {
  /** Inclusive start offset into the source. */
  readonly start: number;
  /** Exclusive end offset into the source. */
  readonly end: number;
  /** Text that replaces the `[start, end)` span. */
  readonly replacement: string;
}

/**
 * Source targets a fix class can inspect when projected into downstream tools.
 *
 * Warden itself decides which committed files it scans. This metadata is for
 * consumers such as Regrade that need to derive a narrower collection before
 * invoking the rule against an explicit downstream root.
 */
export type WardenFixScanTargets = ScanTargets & {
  /**
   * @deprecated Compatibility bridge for Warden-backed Regrade classes that
   * predate PathScope. Prefer Regrade collection scope for new callers.
   */
  readonly ignoredDirectories?: readonly string[];
};

/**
 * Per-finding fix metadata attached to a diagnostic.
 *
 * Authored on the diagnostic at construction because only the rule that matched
 * knows the concrete span. `warden --fix` applies `edits` only when
 * `safety` is `safe`; `review` fixes stay reported with their guidance so a
 * human (or a downstream regrade) can resolve them.
 */
export interface WardenFix {
  /** Transform class this fix belongs to. */
  readonly class: WardenFixClass;
  /** Whether `warden --fix` may apply this automatically. */
  readonly safety: WardenFixSafety;
  /** Source edits to apply, when `safety` is `safe`. Empty for review-only. */
  readonly edits?: readonly WardenFixEdit[] | undefined;
  /** Why the fix is needed and what it changes, for humans and migration notes. */
  readonly reason: string;
  /** Optional pointer to a fixture or example demonstrating the fix. */
  readonly fixture?: string | undefined;
}

/**
 * Per-rule fix capability, projected into the guide/manifest.
 *
 * Declares that a rule can emit {@link WardenFix} metadata and the default
 * safety for its fixes, so `warden --help`, the guide, and agent surfaces can
 * advertise fix availability without a finding in hand. Concrete edits still
 * live on each diagnostic's {@link WardenFix}.
 */
export interface WardenFixCapability {
  /** Transform class the rule's fixes belong to. */
  readonly class: WardenFixClass;
  /** Default safety for fixes this rule emits. */
  readonly safety: WardenFixSafety;
  /** Downstream scan targets for tools that project this fix capability. */
  readonly scanTargets?: WardenFixScanTargets | undefined;
}

/**
 * Stable metadata used to classify Warden rules before dispatch filtering.
 */
export interface WardenRuleMetadata {
  /** Cumulative Warden depth where this rule first becomes relevant. */
  readonly depth: WardenDepth;
  /** Queryable rule concern for agent-facing surfaces. */
  readonly concern: WardenRuleConcern;
  /** One-line invariant the rule protects. */
  readonly invariant: string;
  /** Rule lifecycle. */
  readonly lifecycle: WardenRuleLifecycle;
  /** Where the rule applies. */
  readonly scope: WardenRuleScope;
  /** Narrowest Warden tier that can answer the rule. */
  readonly tier: WardenRuleTier;
  /** Structured remediation guidance for diagnostics emitted by this rule. */
  readonly guidance?: WardenGuidance | undefined;
  /** Declares that this rule can emit fix metadata, for guide projection. */
  readonly fix?: WardenFixCapability | undefined;
}

/**
 * A single diagnostic reported by a warden rule.
 */
export interface WardenDiagnostic extends RuleDiagnosticBase {
  /** Rule identifier, e.g. "no-throw-in-implementation" */
  readonly rule: string;
  /** Optional rule-local diagnostic code for checks with multiple stable findings. */
  readonly code?: string | undefined;
  /** Severity level */
  readonly severity: WardenSeverity;
  /** Human-readable message describing the violation */
  readonly message: string;
  /** 1-based line number where the violation was detected */
  readonly line: number;
  /** File path that was analyzed */
  readonly filePath: string;
  /** Topo/app identity for diagnostics emitted during multi-topo runs. */
  readonly topoName?: string | undefined;
  /** Optional finding-level guidance. Defaults from rule metadata when absent. */
  readonly guidance?: WardenGuidance | undefined;
  /** Optional structured fix for this finding. `warden --fix` applies safe edits. */
  readonly fix?: WardenFix | undefined;
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
 * Options for compose-file rules that need knowledge of all trail IDs in a project.
 */
export interface ProjectContext {
  /** All known contour names in the project. */
  readonly knownContourIds?: ReadonlySet<string>;
  /** Store table IDs used with the CRUD factory across the project. */
  readonly crudTableIds?: ReadonlySet<string>;
  /** All known trail IDs in the project */
  readonly knownTrailIds: ReadonlySet<string>;
  /** Trail IDs registered in configured app topo targets. */
  readonly topoTrailIds?: ReadonlySet<string>;
  /** Declared contour references keyed by source contour name. */
  readonly contourReferencesByName?: ReadonlyMap<string, readonly string[]>;
  /** All known resource IDs in the project */
  readonly knownResourceIds?: ReadonlySet<string>;
  /** All known signal IDs in the project */
  readonly knownSignalIds?: ReadonlySet<string>;
  /** All trail IDs referenced by declared composes arrays across the project. */
  readonly composeTargetTrailIds?: ReadonlySet<string>;
  /** Signal IDs referenced by trail `on` arrays across the project. */
  readonly onTargetSignalIds?: ReadonlySet<string>;
  /** Store table IDs used with reconcile trails across the project. */
  readonly reconcileTableIds?: ReadonlySet<string>;
  /** Resolved import facts keyed by importer file path across the project. */
  readonly importResolutionsByFile?: ReadonlyMap<
    string,
    readonly WardenImportResolution[]
  >;
  /** Resolved docs/specifier facts keyed by documentation file path. */
  readonly documentedImportResolutionsByFile?: ReadonlyMap<
    string,
    readonly WardenImportResolution[]
  >;
  /** Non-private published @ontrails workspaces discovered from the root manifest. */
  readonly publicWorkspaces?: ReadonlyMap<string, WardenPublicWorkspace>;
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
   * Enables compose-file completeness evaluation so one-file-per-operation
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
    topo: Topo,
    context?: { readonly graph?: TopoGraph | undefined } | undefined
  ) => readonly WardenDiagnostic[] | Promise<readonly WardenDiagnostic[]>;
}
