/**
 * Compile-time type assertions for type-utils.
 *
 * This file lives in src/ (not __tests__/) so it is included in the
 * typecheck pass. It contains no runtime code — only type-level
 * assertions that fail the build when type inference regresses.
 *
 * Assertion types are exported to satisfy `noUnusedLocals` but are not
 * re-exported from the package index.
 */

import type { Signal, SignalSpec } from './signal.js';
import type { Trail, TrailSpec, TrailVersionRevisionEntry } from './trail.js';
import type { ExecuteTrailOptions } from './execute.js';
import type { ResourceSpec } from './resource.js';
import type { ContourOptions } from './contour.js';
import type { ScheduleSpec } from './schedule.js';
import type { WebhookSpec } from './webhook.js';
import type { BasePermit } from './permits.js';
import type { Result } from './result.js';
import type { ComposeFn, FireFn } from './types.js';
import type { ComposeInput, TrailInput, TrailOutput } from './type-utils.js';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A trail with composeInput declared. */
type ComposeTrail = Trail<
  { name: string },
  { id: string },
  { forkedFrom: string }
>;

/** A trail without composeInput. */
type PlainTrail = Trail<{ name: string }, { id: string }>;

// ---------------------------------------------------------------------------
// ComposeInput<T> must include composeInput fields
// ---------------------------------------------------------------------------

type WithComposeInput = ComposeInput<ComposeTrail>;

// Must require both `name` AND `forkedFrom`.
// Before the fix, `forkedFrom` was erased.
type AssertMerged = WithComposeInput extends {
  name: string;
  forkedFrom: string;
}
  ? true
  : false;
export type Merged = [AssertMerged] extends [true] ? 'pass' : never;

// ---------------------------------------------------------------------------
// ComposeInput<T> falls back to TrailInput<T> when no composeInput
// ---------------------------------------------------------------------------

type WithoutComposeInput = ComposeInput<PlainTrail>;
type BaseInput = TrailInput<PlainTrail>;

// These should be mutually assignable (identical).
type AssertFallback1 = WithoutComposeInput extends BaseInput ? true : false;
type AssertFallback2 = BaseInput extends WithoutComposeInput ? true : false;
export type Fallback = [AssertFallback1, AssertFallback2] extends [true, true]
  ? 'pass'
  : never;

// ---------------------------------------------------------------------------
// ComposeFn preserves typed trail-object output inference
// ---------------------------------------------------------------------------

declare const plainTrail: PlainTrail;

type TypedComposeResult = ComposeFn extends {
  (trail: typeof plainTrail, input: ComposeInput<typeof plainTrail>): infer R;
}
  ? Awaited<R>
  : never;

type AssertTypedComposeOutput =
  TypedComposeResult extends Result<TrailOutput<typeof plainTrail>, Error>
    ? true
    : false;
type AssertTypedComposeNotNever =
  TrailOutput<typeof plainTrail> extends never ? false : true;
export type TypedTrailObjectComposeOutput = [
  AssertTypedComposeOutput,
  AssertTypedComposeNotNever,
] extends [true, true]
  ? 'pass'
  : never;

// ---------------------------------------------------------------------------
// BlazeInput: blaze receives composeInput fields when declared
// ---------------------------------------------------------------------------

/**
 * When a trail has composeInput, the blaze's first parameter must include
 * both the public input fields AND the composeInput fields. Before the fix,
 * blaze was typed as Implementation<I, O>, losing the CI fields.
 */
type ComposeBlazeParam = Parameters<ComposeTrail['blaze']>[0];

type AssertBlazeHasComposeFields = ComposeBlazeParam extends {
  name: string;
  forkedFrom: string;
}
  ? true
  : false;
export type BlazeWithCompose = [AssertBlazeHasComposeFields] extends [true]
  ? 'pass'
  : never;

// Plain trail blaze should only receive the public input type.
type PlainBlazeParam = Parameters<PlainTrail['blaze']>[0];

type AssertPlainBlazeIsInput = PlainBlazeParam extends { name: string }
  ? true
  : false;
type AssertPlainBlazeNoExtra = { name: string } extends PlainBlazeParam
  ? true
  : false;
export type BlazeWithoutCompose = [
  AssertPlainBlazeIsInput,
  AssertPlainBlazeNoExtra,
] extends [true, true]
  ? 'pass'
  : never;

// ---------------------------------------------------------------------------
// CI = never default preserves backward compat
// ---------------------------------------------------------------------------

// Trail<I, O> (two generics) should be assignable to Trail<I, O, never>
type AssertDefault =
  Trail<{ x: number }, { y: number }> extends Trail<
    { x: number },
    { y: number },
    never
  >
    ? true
    : false;
export type Default = [AssertDefault] extends [true] ? 'pass' : never;

// ---------------------------------------------------------------------------
// Version field is trail-only for the v1 authoring shape
// ---------------------------------------------------------------------------

type AssertTrailVersionAllowed = TrailSpec<
  { name: string },
  { id: string }
>['version'] extends number | undefined
  ? true
  : false;
export type TrailVersionAllowed = [AssertTrailVersionAllowed] extends [true]
  ? 'pass'
  : never;

type AssertTrailMarkerProjected = TrailSpec<
  { name: string },
  { id: string }
>['marker'] extends never | undefined
  ? true
  : false;
export type TrailMarkerProjected = [AssertTrailMarkerProjected] extends [true]
  ? 'pass'
  : never;

type AssertVersionReserved<T extends { readonly version?: never }> =
  T['version'] extends never | undefined ? true : false;
export type NonTrailVersionReservations = [
  AssertVersionReserved<ResourceSpec<unknown>>,
  AssertVersionReserved<SignalSpec<unknown>>,
  AssertVersionReserved<ContourOptions<{ readonly id: z.ZodString }, 'id'>>,
  AssertVersionReserved<ScheduleSpec>,
  AssertVersionReserved<WebhookSpec>,
] extends [true, true, true, true, true]
  ? 'pass'
  : never;

interface RevisionInput {
  readonly legacyName: string;
}
interface RevisionOutput {
  readonly greeting: string;
}
interface CurrentInput {
  readonly name: string;
  readonly notify: boolean;
}
interface CurrentOutput {
  readonly auditLevel: 'current' | 'legacy';
  readonly greeting: string;
}
type RevisionTranspose = NonNullable<
  TrailVersionRevisionEntry<
    RevisionInput,
    RevisionOutput,
    CurrentInput,
    CurrentOutput
  >['transpose']
>;

type AssertRevisionMarkerProjected = TrailVersionRevisionEntry<
  RevisionInput,
  RevisionOutput,
  CurrentInput,
  CurrentOutput
>['marker'] extends never | undefined
  ? true
  : false;
export type RevisionMarkerProjected = [AssertRevisionMarkerProjected] extends [
  true,
]
  ? 'pass'
  : never;

type AssertRevisionInputTranspose = RevisionTranspose['input'] extends (value: {
  readonly input: RevisionInput;
}) => CurrentInput | Promise<CurrentInput>
  ? true
  : false;
type AssertRevisionOutputTranspose =
  RevisionTranspose['output'] extends (value: {
    readonly output: CurrentOutput;
  }) => RevisionOutput | Promise<RevisionOutput>
    ? true
    : false;
type AssertRevisionNoComposeInput = TrailVersionRevisionEntry<
  RevisionInput,
  RevisionOutput,
  CurrentInput,
  CurrentOutput
>['composeInput'] extends never | undefined
  ? true
  : false;
export type RevisionTransposeContract = [
  AssertRevisionInputTranspose,
  AssertRevisionOutputTranspose,
] extends [true, true]
  ? 'pass'
  : never;
export type RevisionRuntimeFieldContract = [
  AssertRevisionNoComposeInput,
] extends [true]
  ? 'pass'
  : never;

// ---------------------------------------------------------------------------
// ExecuteTrailOptions keeps compose-validation internals out of the public API
// ---------------------------------------------------------------------------

type AssertExecuteOptionsHideComposeValidation =
  'composeValidation' extends keyof ExecuteTrailOptions ? false : true;
type AssertExecuteOptionsHideValidationSchema =
  'validationSchema' extends keyof ExecuteTrailOptions ? false : true;
export type ExecuteOptionsPublicBoundary = [
  AssertExecuteOptionsHideComposeValidation,
  AssertExecuteOptionsHideValidationSchema,
] extends [true, true]
  ? 'pass'
  : never;

// ---------------------------------------------------------------------------
// FireFn requires signal values and preserves payload inference
// ---------------------------------------------------------------------------

type OrderPlacedSignal = Signal<{ orderId: string }>;

type AssertFireReturnsVoid = FireFn extends {
  (signal: OrderPlacedSignal, payload: { orderId: string }): infer R;
}
  ? R extends Promise<void>
    ? true
    : false
  : false;
export type FireReturnsVoid = [AssertFireReturnsVoid] extends [true]
  ? 'pass'
  : never;

// ---------------------------------------------------------------------------
// BasePermit preserves readonly fields across schema inference
// ---------------------------------------------------------------------------

declare const permit: BasePermit;
// @ts-expect-error BasePermit.id is immutable once installed on TrailContext.
permit.id = 'next';
// @ts-expect-error BasePermit.scopes is immutable once installed on TrailContext.
permit.scopes.push('next');

type AssertFireAcceptsSignalValue = FireFn extends {
  (signal: OrderPlacedSignal, payload: { orderId: string }): Promise<void>;
}
  ? true
  : false;
export type FireAcceptsSignalValue = [AssertFireAcceptsSignalValue] extends [
  true,
]
  ? 'pass'
  : never;

type AssertFireRejectsStringId = FireFn extends {
  (signalId: string, payload: unknown): unknown;
}
  ? false
  : true;
export type FireRejectsStringId = [AssertFireRejectsStringId] extends [true]
  ? 'pass'
  : never;

type AssertFireRejectsMismatchedPayload = FireFn extends {
  (signal: OrderPlacedSignal, payload: { orderId: number }): unknown;
}
  ? false
  : true;
export type FireRejectsMismatchedPayload = [
  AssertFireRejectsMismatchedPayload,
] extends [true]
  ? 'pass'
  : never;
