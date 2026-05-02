import type { AnySignal } from './signal.js';

export const activationSourceKinds = Object.freeze([
  'signal',
  'schedule',
  'webhook',
] as const);

export type BuiltinActivationSourceKind =
  (typeof activationSourceKinds)[number];

export type ActivationSourceKind = string;

export type ActivationSourceMeta = Readonly<Record<string, unknown>>;

export interface ActivationSource {
  readonly id: string;
  readonly kind: ActivationSourceKind;
  readonly input?: unknown;
  readonly meta?: ActivationSourceMeta | undefined;
}

export interface ActivationWhereExample {
  readonly input?: unknown;
  readonly on: boolean;
  readonly payload?: unknown;
}

export type ActivationWherePredicate = (
  payload: unknown
) => boolean | Promise<boolean>;

export interface ActivationWhere {
  readonly examples?: readonly ActivationWhereExample[] | undefined;
  readonly predicate: ActivationWherePredicate;
}

export type ActivationWhereSpec = ActivationWhere | ActivationWherePredicate;

export type ActivationSourceRef = string | AnySignal | ActivationSource;

export interface ActivationEntrySpec {
  readonly source: ActivationSourceRef;
  readonly meta?: ActivationSourceMeta | undefined;
  readonly where?: ActivationWhereSpec | undefined;
}

export interface ActivationEntry {
  readonly source: ActivationSource;
  readonly meta?: ActivationSourceMeta | undefined;
  readonly where?: ActivationWhereSpec | undefined;
}

export const isKnownActivationSourceKind = (
  kind: string
): kind is BuiltinActivationSourceKind =>
  (activationSourceKinds as readonly string[]).includes(kind);

export const isActivationEntrySpec = (
  value: unknown
): value is ActivationEntrySpec =>
  typeof value === 'object' && value !== null && 'source' in value;

export const isActivationSource = (value: unknown): value is ActivationSource =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  'kind' in value;
