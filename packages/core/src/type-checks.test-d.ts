/**
 * Compile-time type assertions for type-utils.
 *
 * This file lives in src/ (not __tests__/) so it is included in the
 * typecheck pass. It contains type-level assertions that fail the build
 * when type inference regresses, plus a small number of inert const
 * declarations that verify contextual inference at call sites.
 *
 * Assertion types are exported to satisfy `noUnusedLocals` but are not
 * re-exported from the package index.
 */

import type { Signal, SignalSpec } from './signal.js';
import { forkVersion, trail } from './trail.js';
import type { Trail, TrailSpec, TrailVersionRevisionEntry } from './trail.js';
import type { ExecuteTrailOptions } from './execute.js';
import { resource } from './resource.js';
import type { Resource, ResourceSpec } from './resource.js';
import type { EntityOptions } from './entity.js';
import type { ScheduleSpec } from './schedule.js';
import type { WebhookSpec } from './webhook.js';
import type { BasePermit } from './permits.js';
import { Result } from './result.js';
import type { ComposeFn, FireFn } from './types.js';
import type { ComposeInput, TrailInput, TrailOutput } from './type-utils.js';
import type { DraftFinding as DirectDraftFinding } from './draft.js';
import type { TopoIssue as DirectTopoIssue } from './validate-topo.js';
import type {
  DraftDiagnostic as BarrelDraftDiagnostic,
  DraftFinding as BarrelDraftFinding,
  TopoDiagnostic as BarrelTopoDiagnostic,
  TopoMissingReference as BarrelTopoMissingReference,
  TopoIssue as BarrelTopoIssue,
} from './index.js';
import { z } from 'zod';

declare module './draft.js' {
  interface DraftFinding {
    readonly extensionField?: string;
  }
}

declare module './validate-topo.js' {
  interface TopoIssue {
    readonly extensionField?: string;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Assert<T extends true> = T;
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;
type IsAssignable<A, B> = A extends B ? true : false;

declare const compose: ComposeFn;

export type DraftFindingDeprecatedNameStaysCompatible = Assert<
  IsAssignable<BarrelDraftFinding, BarrelDraftDiagnostic>
>;
export type DraftFindingCanonicalStaysAssignable = Assert<
  IsAssignable<BarrelDraftDiagnostic, BarrelDraftFinding>
>;
export type TopoIssueDeprecatedNameStaysCompatible = Assert<
  IsAssignable<BarrelTopoIssue, BarrelTopoDiagnostic>
>;
export type TopoIssueCanonicalStaysAssignable = Assert<
  IsAssignable<BarrelTopoDiagnostic, BarrelTopoIssue>
>;

const augmentedDraftFinding: DirectDraftFinding = {
  extensionField: 'ok',
  id: 'draft.example',
  kind: 'trail',
  message: 'Draft example',
  rule: 'draft-id',
};
void augmentedDraftFinding;

const augmentedTopoIssue: DirectTopoIssue = {
  extensionField: 'ok',
  message: 'Topo example',
  rule: 'example',
  trailId: 'example',
};
void augmentedTopoIssue;

const topoMissingReference: BarrelTopoMissingReference = {
  fromId: 'entity.versioned',
  fromKind: 'trail-version',
  fromTrailId: 'entity.versioned',
  missingId: 'entity.missing',
  referenceKind: 'compose',
  version: 1,
};
void topoMissingReference;

const defaultedTrail = trail('typecheck.defaulted-input', {
  examples: [
    {
      expected: { limit: 20 },
      input: { name: 'Ada' },
      name: 'Caller omits defaulted limit',
    },
  ],
  implementation: (input) => {
    const { limit }: { limit: number } = input;
    return Result.ok({ limit });
  },
  input: z.object({
    limit: z.number().int().positive().default(20),
    name: z.string(),
  }),
  output: z.object({ limit: z.number() }),
});

type DefaultedCallerInput = TrailInput<typeof defaultedTrail>;
type DefaultedComposeInput = ComposeInput<typeof defaultedTrail>;
type DefaultedImplementationInput = Parameters<
  typeof defaultedTrail.implementation
>[0];

export type DefaultedCallerInputIsCallerSide = Assert<
  IsExact<DefaultedCallerInput, { name: string; limit?: number | undefined }>
>;
export type DefaultedComposeInputIsCallerSide = Assert<
  IsExact<DefaultedComposeInput, DefaultedCallerInput>
>;
export type DefaultedImplementationInputIsMaterialized = Assert<
  IsExact<DefaultedImplementationInput, { name: string; limit: number }>
>;

trail('typecheck.output-schema-mismatch', {
  // @ts-expect-error implementation output must match the authored output schema.
  implementation: () => Result.ok({ id: 123 }),
  input: z.object({}),
  output: z.object({ id: z.string() }),
});

export const defaultedTrailObjectComposeOk: Promise<
  Result<{ limit: number }, Error>
> = compose(defaultedTrail, { name: 'Ada' });
// @ts-expect-error caller-side input still requires non-defaulted fields.
compose(defaultedTrail, { limit: 10 });

const composeDefaultSchema = z.object({
  forkedFrom: z.string().default('root'),
});
const composedDefaultedTrail = trail('typecheck.defaulted-compose-input', {
  composeInput: composeDefaultSchema,
  implementation: (input) => Result.ok({ forkedFrom: input.forkedFrom }),
  input: z.object({ name: z.string() }),
  output: z.object({ forkedFrom: z.string() }),
});

type DefaultedComposeOnlyInput = ComposeInput<typeof composedDefaultedTrail>;
type DefaultedComposeOnlyImplementationInput = Parameters<
  typeof composedDefaultedTrail.implementation
>[0];

export type DefaultedComposeOnlyInputIsCallerSide = Assert<
  IsExact<
    DefaultedComposeOnlyInput,
    { name: string } & { forkedFrom?: string | undefined }
  >
>;
export type DefaultedComposeOnlyImplementationInputIsMaterialized = Assert<
  IsExact<
    DefaultedComposeOnlyImplementationInput,
    { name: string } & { forkedFrom: string }
  >
>;
export const defaultedComposeInputTrailObjectComposeOk: Promise<
  Result<{ forkedFrom: string }, Error>
> = compose(composedDefaultedTrail, { name: 'Ada' });

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
export type MergedAssert = Assert<
  IsExact<WithComposeInput, { name: string } & { forkedFrom: string }>
>;

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
export type FallbackAssert = Assert<
  IsExact<WithoutComposeInput, TrailInput<PlainTrail>>
>;

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
export type TypedTrailObjectComposeNotNeverAssert =
  Assert<AssertTypedComposeNotNever>;

declare const composeTrail: ComposeTrail;

export const plainTrailObjectComposeOk: Promise<Result<{ id: string }, Error>> =
  compose(plainTrail, { name: 'Ada' });
export const composeInputTrailObjectComposeOk: Promise<
  Result<{ id: string }, Error>
> = compose(composeTrail, { forkedFrom: 'root', name: 'Ada' });
// @ts-expect-error composeInput fields remain required when authored.
compose(composeTrail, { name: 'Ada' });
export const batchTrailObjectComposeOk: Promise<
  readonly [
    Result<{ id: string }, Error>,
    Result<{ id: string }, Error>,
    Result<unknown, Error>,
  ]
> = compose([
  [plainTrail, { name: 'Ada' }],
  [composeTrail, { forkedFrom: 'root', name: 'Ada' }],
  ['audit.log', { event: 'typed' }],
] as const);

type StringIdComposeCallable = ComposeFn extends {
  (id: string, input: unknown): Promise<Result<unknown, Error>>;
}
  ? true
  : false;
export type StringIdComposeStillCallable = Assert<StringIdComposeCallable>;

// ---------------------------------------------------------------------------
// ImplementationInput: implementation receives composeInput fields when declared
// ---------------------------------------------------------------------------

/**
 * When a trail has composeInput, the implementation's first parameter must include
 * both the public input fields AND the composeInput fields. Before the fix,
 * implementation was typed as Implementation<I, O>, losing the CI fields.
 */
type ComposeImplementationParam = Parameters<ComposeTrail['implementation']>[0];

type AssertImplementationHasComposeFields = ComposeImplementationParam extends {
  name: string;
  forkedFrom: string;
}
  ? true
  : false;
export type ImplementationWithCompose = [
  AssertImplementationHasComposeFields,
] extends [true]
  ? 'pass'
  : never;

// Plain trail implementation should only receive the public input type.
type PlainImplementationParam = Parameters<PlainTrail['implementation']>[0];

type AssertPlainImplementationIsInput = PlainImplementationParam extends {
  name: string;
}
  ? true
  : false;
type AssertPlainImplementationNoExtra = {
  name: string;
} extends PlainImplementationParam
  ? true
  : false;
export type ImplementationWithoutCompose = [
  AssertPlainImplementationIsInput,
  AssertPlainImplementationNoExtra,
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

type AssertTrailMarkerDerived = TrailSpec<
  { name: string },
  { id: string }
>['marker'] extends never | undefined
  ? true
  : false;
export type TrailMarkerDerived = [AssertTrailMarkerDerived] extends [true]
  ? 'pass'
  : never;

type AssertVersionReserved<T extends { readonly version?: never }> =
  T['version'] extends never | undefined ? true : false;
export type NonTrailVersionReservations = [
  AssertVersionReserved<ResourceSpec<unknown>>,
  AssertVersionReserved<SignalSpec<unknown>>,
  AssertVersionReserved<EntityOptions<{ readonly id: z.ZodString }, 'id'>>,
  AssertVersionReserved<ScheduleSpec>,
  AssertVersionReserved<WebhookSpec>,
] extends [true, true, true, true, true]
  ? 'pass'
  : never;

// ---------------------------------------------------------------------------
// resource() carries config schema inference into create(ctx).config
// ---------------------------------------------------------------------------

type ResourceConfigSchema = z.ZodObject<{
  readonly key: z.ZodString;
  readonly poolSize: z.ZodNumber;
}>;
type ConfiguredResource = ReturnType<
  typeof resource<{ readonly connected: true }, ResourceConfigSchema>
>;
type ConfiguredResourceConfig = Parameters<
  ConfiguredResource['create']
>[0]['config'];
interface ExpectedResourceConfig {
  readonly key: string;
  readonly poolSize: number;
}
type AssertResourceConfigForward =
  ConfiguredResourceConfig extends ExpectedResourceConfig ? true : false;
type AssertResourceConfigReverse =
  ExpectedResourceConfig extends ConfiguredResourceConfig ? true : false;
type AssertResourceCarriesConfig =
  ConfiguredResource extends Resource<
    { readonly connected: true },
    ExpectedResourceConfig
  >
    ? true
    : false;
export type ResourceConfigInference = [
  AssertResourceConfigForward,
  AssertResourceConfigReverse,
  AssertResourceCarriesConfig,
] extends [true, true, true]
  ? 'pass'
  : never;

export const inferredConfiguredResource = resource('typecheck.configured', {
  config: {} as ResourceConfigSchema,
  create: (ctx) => {
    const { key, poolSize }: ExpectedResourceConfig = ctx.config;
    return { key, poolSize } as unknown as Result<
      { readonly key: string; readonly poolSize: number },
      Error
    >;
  },
});
export type InferredConfiguredResourceConfig = Parameters<
  typeof inferredConfiguredResource.create
>[0]['config'];
type AssertInferredConfiguredResource =
  InferredConfiguredResourceConfig extends ExpectedResourceConfig
    ? true
    : false;
export type InferredResourceConfigInference = [
  AssertInferredConfiguredResource,
] extends [true]
  ? 'pass'
  : never;

export const inferredDefaultedResource = resource(
  'typecheck.defaulted-config',
  {
    config: {} as z.ZodDefault<
      z.ZodObject<{
        readonly mode: z.ZodLiteral<'noop'>;
      }>
    >,
    create: (ctx) => {
      const { mode }: { readonly mode: 'noop' } = ctx.config;
      return { mode } as unknown as Result<{ readonly mode: 'noop' }, Error>;
    },
  }
);

type PlainResource = ReturnType<typeof resource<number>>;
type PlainResourceConfig = Parameters<PlainResource['create']>[0]['config'];
type AssertPlainResourceConfigUnknown = unknown extends PlainResourceConfig
  ? PlainResourceConfig extends unknown
    ? true
    : false
  : false;
export type ResourceWithoutConfigDefault = [
  AssertPlainResourceConfigUnknown,
] extends [true]
  ? 'pass'
  : never;

export const inferredPlainResource = resource('typecheck.plain', {
  create: (ctx) => {
    // @ts-expect-error config remains unknown when no config schema is authored.
    const { key } = ctx.config;
    return key as unknown as Result<number, Error>;
  },
});

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

type AssertRevisionMarkerDerived = TrailVersionRevisionEntry<
  RevisionInput,
  RevisionOutput,
  CurrentInput,
  CurrentOutput
>['marker'] extends never | undefined
  ? true
  : false;
export type RevisionMarkerDerived = [AssertRevisionMarkerDerived] extends [true]
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
// forkVersion threads the entry's own schemas into the fork implementation (TRL-1180)
// ---------------------------------------------------------------------------

const forkV1Input = z.object({ name: z.string(), weightOz: z.number() });
const forkV1Output = z.object({ id: z.string(), weightOz: z.number() });

const _typedForkEntry = forkVersion({
  implementation: (input) => {
    type AssertForkImplementationInputTyped = Assert<
      IsExact<typeof input, { name: string; weightOz: number }>
    >;
    const _forkImplementationInputTyped: AssertForkImplementationInputTyped = true;
    void _forkImplementationInputTyped;
    return Result.ok({ id: input.name, weightOz: input.weightOz });
  },
  input: forkV1Input,
  output: forkV1Output,
});
type AssertForkEntryAssignable = Assert<
  IsAssignable<
    typeof _typedForkEntry,
    NonNullable<TrailSpec<{ ok: boolean }, string>['versions']>[number]
  >
>;
export type ForkVersionEntryContract = [AssertForkEntryAssignable] extends [
  true,
]
  ? 'pass'
  : never;

const _typedForkEntryOutputChecked = forkVersion({
  // @ts-expect-error — implementation must return the entry output shape, not extras
  implementation: (input) => Result.ok({ unexpected: input.name }),
  input: forkV1Input,
  output: forkV1Output,
});
export type ForkVersionOutputEnforced = typeof _typedForkEntryOutputChecked;

const _typedForkEntryComposeInput = forkVersion({
  composeInput: z.object({ source: z.string() }),
  implementation: (input) => {
    type AssertForkComposeMerged = Assert<
      IsExact<
        typeof input,
        { name: string; weightOz: number } & { source: string }
      >
    >;
    const _forkComposeMerged: AssertForkComposeMerged = true;
    void _forkComposeMerged;
    return Result.ok({ id: input.source, weightOz: input.weightOz });
  },
  input: forkV1Input,
  output: forkV1Output,
});
export type ForkVersionComposeInputContract =
  typeof _typedForkEntryComposeInput;

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
