/**
 * Shared diagnostic vocabulary for governance-style findings.
 *
 * Runtime side-channel records and field-state reports can still define their
 * own shapes. This base exists for tools that report rule or check failures.
 */

export type DiagnosticSeverity = 'error' | 'warn';

export interface DiagnosticBase<TCode extends string = string> {
  readonly code?: TCode | undefined;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
}

export interface RuleDiagnosticBase<
  TCode extends string = string,
  TRule extends string = string,
> extends DiagnosticBase<TCode> {
  readonly rule: TRule;
}
