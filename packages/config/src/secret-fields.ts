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
  readonly parent: VisitedSchema | undefined;
  readonly unionHasMeta?: boolean;
  readonly unionWrappers?: WrapperFacts;
}

type WrapperFacts = Omit<ConfigSecretAncestor, 'path'>;

interface VisitedSchema {
  readonly schema: z.ZodType;
  readonly parent: VisitedSchema | undefined;
}

const hasAncestor = (schema: z.ZodType, parent: VisitedSchema | undefined) => {
  for (let entry = parent; entry; entry = entry.parent) {
    if (schema === entry.schema) {
      return true;
    }
  }
  return false;
};

const supportedSegment = (key: string): boolean =>
  key.length > 0 && !key.includes('.') && key !== '__proto__';

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
      parent: entry.parent,
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
  const discriminator: unknown = Object.getOwnPropertyDescriptor(
    def,
    'discriminator'
  )?.value;
  if (typeof discriminator !== 'string' || !supportedSegment(discriminator)) {
    return incomplete(entry.path);
  }
  const path = entry.path ? `${entry.path}.${discriminator}` : discriminator;
  const selections = Object.getOwnPropertyDescriptor(options, 'discriminants');
  if (selections && !('value' in selections)) {
    return incomplete(path);
  }
  const selection = Object.getOwnPropertyDescriptor(
    selections?.value ?? {},
    path
  );
  if (!selection) {
    return incomplete(path, 'missing-discriminant');
  }
  if (!('value' in selection)) {
    return incomplete(path);
  }
  const selected = selectSecretBranch(
    Object.getOwnPropertyDescriptor(def, 'options')?.value,
    discriminator,
    selection.value
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
  facts: WrapperFacts
): readonly ConfigSecretAncestor[] =>
  facts.optional || facts.defaulted || facts.nullable
    ? [...entry.ancestors, { ...facts, path: entry.path }]
    : entry.ancestors;

const localWrappers = (
  shape: WrapperFacts,
  union: WrapperFacts | undefined
): WrapperFacts => ({
  defaulted: shape.defaulted || union?.defaulted === true,
  nullable: shape.nullable || union?.nullable === true,
  optional: shape.optional || union?.optional === true,
});

const supportsSecretField = (schema: z.ZodType, type: unknown): boolean =>
  type === 'object' ||
  type === 'union' ||
  isSecretScalar(schema) ||
  (type === 'array' && isInspectableSecretArray(schema));

/**
 * Derive declared secret fields without reading values or evaluating schemas.
 *
 * Pass only trusted, application-owned Zod schemas and ordinary inputs. No
 * object in the inspected schema, metadata, or options graph may be a Proxy.
 * This helper is not a sandbox and does not detect Proxies. Inputs outside
 * this contract are not guaranteed to return typed incompleteness.
 *
 * Select discriminated unions explicitly; defaults never choose a branch.
 * Inspection accepts only known value-preserving checks and ancestor shapes.
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
  const queue: WalkEntry[] = [
    { ancestors: [], parent: undefined, path: '', schema },
  ];
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    const shape = unwrapSecretField(entry.schema);
    if (!shape || hasAncestor(shape.base, entry.parent)) {
      return incomplete(entry.path);
    }
    const def = zodDef(shape.base);
    const { type } = def;
    if (!supportsSecretField(shape.base, type)) {
      return incomplete(entry.path);
    }
    const { meta } = shape;
    const hasMeta = meta?.secret === true || meta?.env !== undefined;
    if (entry.unionHasMeta && hasMeta) {
      return incomplete(entry.path);
    }
    const wrappers = localWrappers(shape, entry.unionWrappers);
    if (meta?.secret) {
      fields.push({
        ...(meta.env === undefined ? {} : { env: meta.env }),
        ancestors: entry.ancestors,
        path: entry.path,
        required: !wrappers.optional && !wrappers.defaulted,
        secret: true,
      });
    }
    const childEntry = {
      ancestors: entry.ancestors,
      parent: { parent: entry.parent, schema: shape.base },
      path: entry.path,
      schema: shape.base,
    };
    let issue: ReturnType<typeof incomplete> | null = null;
    if (type === 'object') {
      issue = queueObject(
        { ...childEntry, ancestors: ancestorFacts(entry, wrappers) },
        queue
      );
    } else if (type === 'union') {
      issue = queueBranch(
        { ...childEntry, unionHasMeta: hasMeta, unionWrappers: wrappers },
        queue,
        options
      );
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
