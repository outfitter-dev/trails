import type { WardenDiagnostic, WardenRule } from './types.js';
import { isTestFile } from './scan.js';
import {
  findTrailLikeSpecs,
  parseArrayEntries,
  parseObjectProperties,
  parseStringLiteral,
  parseZodObjectShape,
} from './specs.js';
import type { ObjectProperty, ParsedEntry, TrailLikeSpec } from './specs.js';

interface ExampleCheckContext {
  readonly filePath: string;
  readonly inputRequiredKeys: ReadonlySet<string>;
  readonly outputRequiredKeys: ReadonlySet<string>;
  readonly sourceCode: string;
  readonly trailId: string;
}

const valueStart = (property: ObjectProperty): number =>
  property.start + property.text.indexOf(property.value);

const requiredKeysOf = (schemaText: string): ReadonlySet<string> =>
  new Set(
    [...parseZodObjectShape(schemaText).entries()]
      .filter(([, field]) => field.required)
      .map(([key]) => key)
  );

const exampleNameOf = (
  example: ReadonlyMap<string, ObjectProperty>,
  exampleEntry: ParsedEntry
): string =>
  parseStringLiteral(example.get('name')?.value ?? '') ??
  `line ${exampleEntry.line}`;

const missingKeysOf = (
  objectText: string,
  requiredKeys: ReadonlySet<string>
): readonly string[] => {
  const trimmed = objectText.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return [];
  }

  const presentKeys = new Set(
    parseObjectProperties(trimmed, 0, trimmed).keys()
  );
  return [...requiredKeys].filter((key) => !presentKeys.has(key));
};

const reportMissingKeys = (
  context: ExampleCheckContext,
  line: number,
  exampleName: string,
  kind: 'expected' | 'input',
  missingKeys: readonly string[]
): readonly WardenDiagnostic[] =>
  missingKeys.map((key) => ({
    filePath: context.filePath,
    line,
    message: `Trail "${context.trailId}" example "${exampleName}" is missing required ${kind} key "${key}".`,
    rule: 'examples-match-schema',
    severity: 'error' as const,
  }));

const reportMissingInput = (
  context: ExampleCheckContext,
  exampleEntry: ParsedEntry,
  exampleName: string
): WardenDiagnostic => ({
  filePath: context.filePath,
  line: exampleEntry.line,
  message: `Trail "${context.trailId}" example "${exampleName}" is missing an input object.`,
  rule: 'examples-match-schema',
  severity: 'error',
});

const diagnosticsForInput = (
  context: ExampleCheckContext,
  exampleEntry: ParsedEntry,
  exampleName: string,
  inputValue: ObjectProperty | undefined
): readonly WardenDiagnostic[] => {
  if (inputValue === undefined) {
    return [reportMissingInput(context, exampleEntry, exampleName)];
  }

  return reportMissingKeys(
    context,
    inputValue.line,
    exampleName,
    'input',
    missingKeysOf(inputValue.value, context.inputRequiredKeys)
  );
};

const diagnosticsForExpected = (
  context: ExampleCheckContext,
  exampleName: string,
  expectedValue: ObjectProperty | undefined
): readonly WardenDiagnostic[] => {
  if (expectedValue === undefined || context.outputRequiredKeys.size === 0) {
    return [];
  }

  return reportMissingKeys(
    context,
    expectedValue.line,
    exampleName,
    'expected',
    missingKeysOf(expectedValue.value, context.outputRequiredKeys)
  );
};

const diagnosticsForExample = (
  context: ExampleCheckContext,
  exampleEntry: ParsedEntry
): readonly WardenDiagnostic[] => {
  if (!exampleEntry.text.startsWith('{')) {
    return [];
  }

  const example = parseObjectProperties(
    exampleEntry.text,
    exampleEntry.start,
    context.sourceCode
  );
  const exampleName = exampleNameOf(example, exampleEntry);

  return [
    ...diagnosticsForInput(
      context,
      exampleEntry,
      exampleName,
      example.get('input')
    ),
    ...diagnosticsForExpected(context, exampleName, example.get('expected')),
  ];
};

const diagnosticsForSpec = (
  sourceCode: string,
  filePath: string,
  spec: TrailLikeSpec
): readonly WardenDiagnostic[] => {
  const examples = spec.properties.get('examples');
  const input = spec.properties.get('input');
  if (!examples || !input) {
    return [];
  }

  const context: ExampleCheckContext = {
    filePath,
    inputRequiredKeys: requiredKeysOf(input.value),
    outputRequiredKeys: requiredKeysOf(
      spec.properties.get('output')?.value ?? ''
    ),
    sourceCode,
    trailId: spec.id,
  };

  return parseArrayEntries(
    examples.value,
    valueStart(examples),
    sourceCode
  ).flatMap((exampleEntry) => diagnosticsForExample(context, exampleEntry));
};

/**
 * Errors when literal examples omit required keys from the trail input/output
 * schemas.
 */
export const examplesMatchSchema: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    return findTrailLikeSpecs(sourceCode).flatMap((spec) =>
      diagnosticsForSpec(sourceCode, filePath, spec)
    );
  },
  description:
    'Ensure literal examples include the required keys from their input and output schemas.',
  name: 'examples-match-schema',
  severity: 'error',
};
