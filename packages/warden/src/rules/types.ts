/**
 * Severity level for warden diagnostics.
 */
export type WardenSeverity = 'error' | 'warn';

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
 * A warden rule is a function that analyzes source code and returns diagnostics.
 *
 * Rules use string/regex analysis (not full AST parsing) to detect patterns
 * that violate Trails conventions.
 */
export interface WardenRule {
  /** Unique rule identifier */
  readonly name: string;
  /** Default severity */
  readonly severity: WardenSeverity;
  /** Human-readable description of what the rule enforces */
  readonly description: string;
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
  /** All known trail IDs in the project */
  readonly knownTrailIds: ReadonlySet<string>;
  /** All known resource IDs in the project */
  readonly knownProvisionIds?: ReadonlySet<string>;
  /** All trail IDs referenced as detour targets across the project */
  readonly detourTargetTrailIds?: ReadonlySet<string>;
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
