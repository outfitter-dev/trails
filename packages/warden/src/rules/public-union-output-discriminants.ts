import { filterSurfaceTrails, zodToJsonSchema } from '@ontrails/core';
import type { AnyTrail, Topo } from '@ontrails/core';

import type { TopoAwareWardenRule, WardenDiagnostic } from './types.js';

const RULE_NAME = 'public-union-output-discriminants';

type JsonSchema = Readonly<Record<string, unknown>>;

interface ObjectBranch {
  readonly properties: Readonly<Record<string, JsonSchema>>;
  readonly required: ReadonlySet<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isJsonSchema = (value: unknown): value is JsonSchema => isRecord(value);

const schemaForTrailOutput = (trail: AnyTrail): JsonSchema | undefined => {
  if (!trail.output) {
    return undefined;
  }
  try {
    return zodToJsonSchema(trail.output);
  } catch {
    return undefined;
  }
};

const readProperties = (
  schema: JsonSchema
): Readonly<Record<string, JsonSchema>> | undefined => {
  const { properties } = schema;
  if (!isRecord(properties)) {
    return undefined;
  }
  const entries = Object.entries(properties);
  if (!entries.every(([, value]) => isJsonSchema(value))) {
    return undefined;
  }
  return properties as Readonly<Record<string, JsonSchema>>;
};

const readRequired = (schema: JsonSchema): ReadonlySet<string> => {
  const { required } = schema;
  if (!Array.isArray(required)) {
    return new Set();
  }
  return new Set(
    required.filter((entry): entry is string => typeof entry === 'string')
  );
};

const objectBranchFromSchema = (schema: unknown): ObjectBranch | undefined => {
  if (!isJsonSchema(schema) || schema['type'] !== 'object') {
    return undefined;
  }
  const properties = readProperties(schema);
  if (!properties) {
    return undefined;
  }
  return { properties, required: readRequired(schema) };
};

const objectBranchesFromAnyOf = (
  schema: JsonSchema
): readonly ObjectBranch[] | undefined => {
  const { anyOf } = schema;
  if (!Array.isArray(anyOf) || anyOf.length < 2) {
    return undefined;
  }
  const branches = anyOf.flatMap((branch) => {
    const objectBranch = objectBranchFromSchema(branch);
    return objectBranch ? [objectBranch] : [];
  });
  return branches.length >= 2 ? branches : undefined;
};

const hasConst = (schema: JsonSchema): boolean =>
  Object.hasOwn(schema, 'const');

const constValue = (schema: JsonSchema): unknown => schema['const'];

const constKey = (value: unknown): string => JSON.stringify(value);

const branchLiteralForKey = (
  branch: ObjectBranch,
  key: string
): unknown | undefined => {
  if (!branch.required.has(key)) {
    return undefined;
  }
  const property = branch.properties[key];
  return property && hasConst(property) ? constValue(property) : undefined;
};

const hasRequiredLiteralDiscriminant = (
  branches: readonly ObjectBranch[]
): boolean => {
  const [first] = branches;
  if (!first) {
    return false;
  }

  return Object.keys(first.properties).some((key) => {
    const values = branches.map((branch) => branchLiteralForKey(branch, key));
    return (
      values.every((value) => value !== undefined) &&
      new Set(values.map(constKey)).size === branches.length
    );
  });
};

const diagnosticForTrail = (trail: AnyTrail): WardenDiagnostic => ({
  filePath: '<topo>',
  line: 1,
  message:
    `Trail "${trail.id}" exposes a public output anyOf with object variants but no required literal discriminator. ` +
    'Add a shared z.literal(...) field or z.discriminatedUnion(...) so surfaces and agents can select the output branch.',
  rule: RULE_NAME,
  severity: 'error',
});

const diagnoseTrail = (trail: AnyTrail): WardenDiagnostic | undefined => {
  const schema = schemaForTrailOutput(trail);
  if (!schema) {
    return undefined;
  }
  const objectBranches = objectBranchesFromAnyOf(schema);
  if (!objectBranches) {
    return undefined;
  }
  return hasRequiredLiteralDiscriminant(objectBranches)
    ? undefined
    : diagnosticForTrail(trail);
};

export const publicUnionOutputDiscriminants: TopoAwareWardenRule = {
  checkTopo(topo: Topo): readonly WardenDiagnostic[] {
    return filterSurfaceTrails(topo.list()).flatMap((trail) => {
      const diagnostic = diagnoseTrail(trail);
      return diagnostic ? [diagnostic] : [];
    });
  },
  description:
    'Require public trail output object unions to expose a required literal discriminator.',
  name: RULE_NAME,
  severity: 'error',
};
