import type { z } from 'zod';

import {
  isInspectableSecretArray,
  isSecretScalar,
  secretObjectShape,
  selectSecretBranch,
  unwrapSecretField,
} from './secret-field-shape.js';
import { zodDef } from './zod-utils.js';

/** Ancestor wrapper facts, not an executable formula for runtime presence. */
export interface ConfigSecretAncestor {
  readonly path: string;
  readonly optional: boolean;
  readonly defaulted: boolean;
  readonly nullable: boolean;
}

/** Declared sensitive field metadata, without values or schema objects. */
export interface ConfigSecretField {
  readonly path: string;
  readonly env?: string;
  readonly secret: true;
  /** Local declaration only; ancestors and refinements can affect applicability. */
  readonly required: boolean;
  readonly ancestors: readonly ConfigSecretAncestor[];
}

/** Completeness covers declared metadata of the supported selected schema only. */
export type ConfigSecretFieldDerivation =
  | { readonly complete: true; readonly fields: readonly ConfigSecretField[] }
  | {
      readonly complete: false;
      readonly path: string;
      readonly reason:
        | 'missing-discriminant'
        | 'invalid-discriminant'
        | 'unsupported-schema';
    };

export interface DeriveConfigSecretFieldsOptions {
  /** Explicit non-secret literal selections, keyed by full dot-separated path. */
  readonly discriminants?: Readonly<
    Record<string, string | number | boolean | null>
  >;
}

interface WalkEntry {
  readonly schema: z.ZodType;
  readonly path: string;
  readonly ancestors: readonly ConfigSecretAncestor[];
}

const supportedSegment = (key: string): boolean =>
  key.length > 0 && !key.includes('.');

const incomplete = (
  path: string,
  reason:
    | 'missing-discriminant'
    | 'invalid-discriminant'
    | 'unsupported-schema' = 'unsupported-schema'
): Extract<ConfigSecretFieldDerivation, { complete: false }> => ({
  complete: false,
  path,
  reason,
});

const queueObject = (entry: WalkEntry, queue: WalkEntry[]) => {
  const shape = secretObjectShape(entry.schema);
  if (!shape) {
    return incomplete(entry.path);
  }
  for (const [key, schema] of Object.entries(shape)) {
    if (!supportedSegment(key)) {
      return incomplete(entry.path);
    }
    queue.push({
      ancestors: entry.ancestors,
      path: entry.path ? `${entry.path}.${key}` : key,
      schema,
    });
  }
  return null;
};

const queueBranch = (
  entry: WalkEntry,
  queue: WalkEntry[],
  options: DeriveConfigSecretFieldsOptions
) => {
  const def = zodDef(entry.schema);
  const { discriminator } = def;
  if (
    typeof discriminator !== 'string' ||
    !supportedSegment(discriminator) ||
    !Array.isArray(def['options'])
  ) {
    return incomplete(entry.path);
  }
  const path = entry.path ? `${entry.path}.${discriminator}` : discriminator;
  if (!Object.hasOwn(options.discriminants ?? {}, path)) {
    return incomplete(path, 'missing-discriminant');
  }
  const selected = selectSecretBranch(
    def['options'],
    discriminator,
    options.discriminants?.[path]
  );
  if (selected.kind !== 'selected') {
    return incomplete(
      path,
      selected.kind === 'invalid'
        ? 'invalid-discriminant'
        : 'unsupported-schema'
    );
  }
  queue.push({ ...entry, schema: selected.schema });
  return null;
};

const ancestorFacts = (
  entry: WalkEntry,
  shape: ReturnType<typeof unwrapSecretField>
): readonly ConfigSecretAncestor[] =>
  shape.optional || shape.defaulted || shape.nullable
    ? [
        ...entry.ancestors,
        {
          defaulted: shape.defaulted,
          nullable: shape.nullable,
          optional: shape.optional,
          path: entry.path,
        },
      ]
    : entry.ancestors;

/**
 * Derive declared secret fields without reading values or evaluating schemas.
 *
 * Select discriminated unions explicitly; defaults never choose a branch.
 * Optional/defaulted leaves are not locally required; nullable alone is required.
 * Ancestor flags do not model wrapper order, default contents, or refinements.
 * Profile owners must derive effective provisioning from their selected context.
 * A field without `env` is sensitive but has no declared environment name.
 *
 * @example
 * ```ts
 * const schema = z.object({ token: secret(env(z.string(), 'TOKEN')) });
 * const derivation = deriveConfigSecretFields(schema);
 * ```
 */
export const deriveConfigSecretFields = (
  schema: z.ZodType,
  options: DeriveConfigSecretFieldsOptions = {}
): ConfigSecretFieldDerivation => {
  const fields: ConfigSecretField[] = [];
  const queue: WalkEntry[] = [{ ancestors: [], path: '', schema }];
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    const shape = unwrapSecretField(entry.schema);
    const def = zodDef(shape.base);
    const { type } = def;
    const supported =
      type === 'object' ||
      type === 'union' ||
      isSecretScalar(shape.base) ||
      (type === 'array' && isInspectableSecretArray(shape.base));
    if (!supported) {
      return incomplete(entry.path);
    }
    const { meta } = shape;
    if (meta?.secret) {
      fields.push({
        ...(meta.env === undefined ? {} : { env: meta.env }),
        ancestors: entry.ancestors,
        path: entry.path,
        required: !shape.optional && !shape.defaulted,
        secret: true,
      });
    }
    const childEntry = {
      ancestors: ancestorFacts(entry, shape),
      path: entry.path,
      schema: shape.base,
    };
    let issue: ReturnType<typeof incomplete> | null = null;
    if (type === 'object') {
      issue = queueObject(childEntry, queue);
    } else if (type === 'union') {
      issue = queueBranch(childEntry, queue, options);
    }
    if (issue) {
      return issue;
    }
  }
  fields.sort((a, b) => {
    if (a.path === b.path) {
      return 0;
    }
    return a.path < b.path ? -1 : 1;
  });
  return { complete: true, fields };
};
