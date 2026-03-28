import type { WardenDiagnostic, WardenRule } from './types.js';
import { isTestFile } from './scan.js';
import {
  findTrailLikeSpecs,
  parseArrayEntries,
  parseObjectProperties,
  parseStringLiteral,
  parseZodObjectShape,
} from './specs.js';

const REDUNDANT_OVERRIDE_KEYS = new Set(['label', 'options']);

const hasOnlyRedundantKeys = (
  properties: ReadonlyMap<string, { value: string }>
): boolean =>
  [...properties.keys()].every((key) => REDUNDANT_OVERRIDE_KEYS.has(key));

const redundantLabelPart = (
  derivedLabel: string,
  properties: ReadonlyMap<string, { value: string }>
): string[] => {
  const label = parseStringLiteral(properties.get('label')?.value ?? '');
  return label !== null && label === derivedLabel ? ['label'] : [];
};

const optionsAreDerivedDefaults = (
  optionsText: string,
  schemaOptions: readonly string[]
): boolean => {
  const entries = parseArrayEntries(optionsText, 0, optionsText);
  if (entries.length !== schemaOptions.length) {
    return false;
  }

  return entries.every((entry, index) => {
    if (!entry.text.startsWith('{')) {
      return false;
    }

    const properties = parseObjectProperties(entry.text, 0, entry.text);
    if (properties.size !== 1) {
      return false;
    }

    const value = parseStringLiteral(properties.get('value')?.value ?? '');
    return value !== null && value === schemaOptions[index];
  });
};

const redundantOptionsPart = (
  options: { value: string } | undefined,
  schemaOptions: readonly string[] | undefined
): string[] =>
  options !== undefined &&
  schemaOptions !== undefined &&
  optionsAreDerivedDefaults(options.value, schemaOptions)
    ? ['options']
    : [];

const findRedundantParts = (
  fieldKey: string,
  fieldOverride: string,
  schemaText: string
): string[] => {
  const fieldInfo = parseZodObjectShape(schemaText).get(fieldKey);
  if (!fieldInfo) {
    return [];
  }

  const properties = parseObjectProperties(fieldOverride, 0, fieldOverride);
  if (properties.size === 0) {
    return ['field metadata'];
  }

  if (!hasOnlyRedundantKeys(properties)) {
    return [];
  }

  const redundant = [
    ...redundantLabelPart(fieldInfo.derivedLabel, properties),
    ...redundantOptionsPart(properties.get('options'), fieldInfo.options),
  ];

  return redundant.length === properties.size ? redundant : [];
};

const diagnosticsForSpec = (
  sourceCode: string,
  filePath: string,
  spec: ReturnType<typeof findTrailLikeSpecs>[number]
): readonly WardenDiagnostic[] => {
  const input = spec.properties.get('input');
  const fields = spec.properties.get('fields');
  if (!input || !fields) {
    return [];
  }

  const fieldEntries = parseObjectProperties(
    fields.value,
    fields.start,
    sourceCode
  );
  return [...fieldEntries.entries()]
    .map(([fieldKey, fieldEntry]) => ({
      fieldEntry,
      fieldKey,
      redundantParts: findRedundantParts(
        fieldKey,
        fieldEntry.value,
        input.value
      ),
    }))
    .filter(({ redundantParts }) => redundantParts.length > 0)
    .map(({ fieldEntry, fieldKey, redundantParts }) => ({
      filePath,
      line: fieldEntry.line,
      message: `Trail "${spec.id}" field "${fieldKey}" only repeats schema-derived ${redundantParts.join(' and ')}. Remove the override and let deriveFields() infer it.`,
      rule: 'prefer-schema-inference',
      severity: 'warn' as const,
    }));
};

/**
 * Warns when a fields override only repeats metadata deriveFields() already gets from
 * the schema.
 */
export const preferSchemaInference: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    return findTrailLikeSpecs(sourceCode).flatMap((spec) =>
      diagnosticsForSpec(sourceCode, filePath, spec)
    );
  },
  description:
    'Warn when fields overrides only restate labels or enum options deriveFields() already infers from the Zod schema.',
  name: 'prefer-schema-inference',
  severity: 'warn',
};
