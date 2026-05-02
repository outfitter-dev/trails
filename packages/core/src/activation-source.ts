import type { z } from 'zod';

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

export type ActivationSourceParse<TPayload = unknown> =
  | z.ZodType<TPayload>
  | {
      readonly output?: z.ZodType<TPayload> | undefined;
    };

export interface ActivationSource {
  readonly id: string;
  readonly kind: ActivationSourceKind;
  readonly cron?: string | undefined;
  readonly input?: unknown;
  readonly meta?: ActivationSourceMeta | undefined;
  readonly parse?: ActivationSourceParse | undefined;
  readonly payload?: z.ZodType<unknown> | undefined;
  readonly timezone?: string | undefined;
}

export interface ActivationWhereExample {
  readonly input?: unknown;
  readonly on: boolean;
  readonly payload?: unknown;
}

/* oxlint-disable no-explicit-any -- contextual predicate authoring needs source-specific payload inference; unknown would make inline predicates unusable until a helper API exists. */
export type ActivationWherePredicate<TPayload = any> = (
  payload: TPayload
) => boolean | Promise<boolean>;

export interface ActivationWhere<TPayload = any> {
  readonly examples?: readonly ActivationWhereExample[] | undefined;
  readonly predicate: ActivationWherePredicate<TPayload>;
}

export type ActivationWhereSpec<TPayload = any> =
  | ActivationWhere<TPayload>
  | ActivationWherePredicate<TPayload>;

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

export const getActivationWherePredicate = (
  where: ActivationWhereSpec | undefined
): ActivationWherePredicate | undefined =>
  typeof where === 'function' ? where : where?.predicate;

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
