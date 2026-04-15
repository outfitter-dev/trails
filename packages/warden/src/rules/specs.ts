import {
  captureBalanced,
  lineNumberAt,
  splitTopLevelEntriesWithOffsets,
} from './structure.js';
import type { SplitEntry } from './structure.js';

export interface ParsedEntry {
  readonly line: number;
  readonly start: number;
  readonly text: string;
}

export interface ObjectProperty extends ParsedEntry {
  readonly key: string;
  readonly value: string;
}

export interface TrailLikeSpec {
  readonly id: string;
  readonly kind: 'signal' | 'trail';
  readonly line: number;
  readonly properties: ReadonlyMap<string, ObjectProperty>;
  readonly specText: string;
  readonly start: number;
}

export interface SchemaFieldInfo {
  readonly derivedLabel: string;
  readonly options?: readonly string[] | undefined;
  readonly required: boolean;
}

const TRAIL_LIKE_PATTERN = /\b(trail|signal)\s*\(/g;

const PROPERTY_PATTERN =
  /^(?:readonly\s+)?(?:(["'`])([^"'`]+)\1|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]+)$/;

const OPTIONALISH_PATTERN =
  /(?:^|[^\w])z\.(?:default|nullish|optional)\s*\(|\.(?:default|nullish|optional)\s*\(/;

const humanize = (str: string): string =>
  str
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (ch) => ch.toUpperCase());

const trimWrapped = (
  text: string,
  open: '{' | '[',
  close: '}' | ']'
): string | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(open) || !trimmed.endsWith(close)) {
    return null;
  }

  return trimmed.slice(1, -1);
};

const firstEntry = (text: string): SplitEntry | null => {
  const [entry] = splitTopLevelEntriesWithOffsets(text);
  return entry ?? null;
};

const createParsedEntry = (
  sourceCode: string,
  start: number,
  text: string
): ParsedEntry => ({
  line: lineNumberAt(sourceCode, start),
  start,
  text,
});

const createObjectProperty = (
  entry: SplitEntry,
  key: string,
  value: string,
  objectStart: number,
  objectOffset: number,
  sourceCode: string
): ObjectProperty => {
  const start = objectStart + objectOffset + 1 + entry.start;
  return {
    key,
    line: lineNumberAt(sourceCode, start),
    start,
    text: entry.text,
    value,
  };
};

const parsePropertyEntry = (
  entry: SplitEntry,
  objectStart: number,
  objectOffset: number,
  sourceCode: string
): ObjectProperty | null => {
  const propertyMatch = entry.text.match(PROPERTY_PATTERN);
  const key = propertyMatch?.[2] ?? propertyMatch?.[3];
  const value = propertyMatch?.[4]?.trim();
  if (!key || !value) {
    return null;
  }

  return createObjectProperty(
    entry,
    key,
    value,
    objectStart,
    objectOffset,
    sourceCode
  );
};

const isDefined = <T>(value: T | null): value is T => value !== null;

export const parseStringLiteral = (text: string): string | null => {
  const trimmed = text.trim();
  const [quote = ''] = trimmed;
  const closer = quote === "'" || quote === '"' || quote === '`' ? quote : null;
  if (closer === null || trimmed.at(-1) !== closer) {
    return null;
  }

  const value = trimmed.slice(1, -1);
  if (quote === '`' && value.includes('${')) {
    return null;
  }

  return value;
};

export const parseArrayEntries = (
  arrayText: string,
  arrayStart: number,
  sourceCode: string
): readonly ParsedEntry[] => {
  const inner = trimWrapped(arrayText, '[', ']');
  if (inner === null) {
    return [];
  }

  const arrayOffset = arrayText.indexOf('[');
  return splitTopLevelEntriesWithOffsets(inner).map((entry) =>
    createParsedEntry(
      sourceCode,
      arrayStart + arrayOffset + 1 + entry.start,
      entry.text
    )
  );
};

export const parseObjectProperties = (
  objectText: string,
  objectStart: number,
  sourceCode: string
): ReadonlyMap<string, ObjectProperty> => {
  const inner = trimWrapped(objectText, '{', '}');
  if (inner === null) {
    return new Map();
  }

  const objectOffset = objectText.indexOf('{');
  const properties = splitTopLevelEntriesWithOffsets(inner)
    .map((entry) =>
      parsePropertyEntry(entry, objectStart, objectOffset, sourceCode)
    )
    .filter(isDefined);

  return new Map(properties.map((property) => [property.key, property]));
};

const resolveSpecTarget = (
  args: readonly SplitEntry[]
): { id: string | null; specArg: SplitEntry } | null => {
  const [firstArg, secondArg] = args;
  if (!firstArg) {
    return null;
  }

  const id = parseStringLiteral(firstArg.text);
  return {
    id,
    specArg: id === null ? firstArg : (secondArg ?? firstArg),
  };
};

const parseCallArguments = (
  sourceCode: string,
  callStart: number
): { argsStart: number; argsText: string } | null => {
  const openParen = sourceCode.indexOf('(', callStart);
  const call = openParen === -1 ? null : captureBalanced(sourceCode, openParen);
  if (call === null || openParen === -1) {
    return null;
  }

  return {
    argsStart: openParen + 1,
    argsText: call.text.slice(1, -1),
  };
};

const isSpecObject = (entry: SplitEntry | undefined): entry is SplitEntry =>
  entry !== undefined && entry.text.trim().startsWith('{');

const resolveSpecId = (
  resolved: { id: string | null; specArg: SplitEntry },
  properties: ReadonlyMap<string, ObjectProperty>
): string | null =>
  resolved.id ?? parseStringLiteral(properties.get('id')?.value ?? '');

const buildTrailLikeSpec = (
  sourceCode: string,
  kind: 'signal' | 'trail',
  specArg: SplitEntry,
  specStart: number,
  id: string,
  properties: ReadonlyMap<string, ObjectProperty>
): TrailLikeSpec => ({
  id,
  kind,
  line: lineNumberAt(sourceCode, specStart),
  properties,
  specText: specArg.text,
  start: specStart,
});

const parseResolvedSpec = (
  sourceCode: string,
  resolved: { id: string | null; specArg: SplitEntry },
  call: { argsStart: number; argsText: string }
): {
  id: string;
  properties: ReadonlyMap<string, ObjectProperty>;
  specStart: number;
} | null => {
  const specStart = call.argsStart + resolved.specArg.start;
  const properties = parseObjectProperties(
    resolved.specArg.text,
    specStart,
    sourceCode
  );
  const id = resolveSpecId(resolved, properties);
  return id === null ? null : { id, properties, specStart };
};

const resolveTrailLikeSpec = (
  sourceCode: string,
  callStart: number
): {
  parsed: {
    id: string;
    properties: ReadonlyMap<string, ObjectProperty>;
    specStart: number;
  };
  resolved: { id: string | null; specArg: SplitEntry };
} | null => {
  const call = parseCallArguments(sourceCode, callStart);
  if (call === null) {
    return null;
  }

  const resolved = resolveSpecTarget(
    splitTopLevelEntriesWithOffsets(call.argsText)
  );
  if (!resolved || !isSpecObject(resolved.specArg)) {
    return null;
  }

  const parsed = parseResolvedSpec(sourceCode, resolved, call);
  return parsed === null ? null : { parsed, resolved };
};

const parseTrailLikeMatch = (
  sourceCode: string,
  kind: 'signal' | 'trail',
  callStart: number
): TrailLikeSpec | null => {
  const resolved = resolveTrailLikeSpec(sourceCode, callStart);
  if (resolved === null) {
    return null;
  }

  return buildTrailLikeSpec(
    sourceCode,
    kind,
    resolved.resolved.specArg,
    resolved.parsed.specStart,
    resolved.parsed.id,
    resolved.parsed.properties
  );
};

const findCallArguments = (
  sourceText: string,
  pattern: RegExp
): string | null => {
  const index = pattern.exec(sourceText)?.index;
  if (index === undefined) {
    return null;
  }

  return parseCallArguments(sourceText, index)?.argsText ?? null;
};

const parseStringArrayLiteral = (
  arrayText: string
): readonly string[] | null => {
  const inner = trimWrapped(arrayText, '[', ']');
  if (inner === null) {
    return null;
  }

  const values = splitTopLevelEntriesWithOffsets(inner).map((entry) =>
    parseStringLiteral(entry.text)
  );
  const strings = values.filter((value): value is string => value !== null);
  return strings.length === values.length ? strings : null;
};

const parseDescribeLabel = (fieldText: string): string | undefined => {
  const args = findCallArguments(fieldText, /\.describe\s*\(/);
  return args === null ? undefined : (parseStringLiteral(args) ?? undefined);
};

const parseEnumValues = (fieldText: string): readonly string[] | undefined => {
  const args = findCallArguments(fieldText, /\bz\.enum\s*\(/);
  const entry = args === null ? null : firstEntry(args);
  return entry ? (parseStringArrayLiteral(entry.text) ?? undefined) : undefined;
};

const toSchemaFieldInfo = (
  key: string,
  property: ObjectProperty
): SchemaFieldInfo => ({
  derivedLabel: parseDescribeLabel(property.value) ?? humanize(key),
  options: parseEnumValues(property.value),
  required: !OPTIONALISH_PATTERN.test(property.value),
});

export const findTrailLikeSpecs = (
  sourceCode: string
): readonly TrailLikeSpec[] => {
  const specs: TrailLikeSpec[] = [];

  for (const match of sourceCode.matchAll(TRAIL_LIKE_PATTERN)) {
    const callStart = match.index;
    if (callStart === undefined) {
      continue;
    }

    const kind = match[1] === 'signal' ? 'signal' : 'trail';
    const spec = parseTrailLikeMatch(sourceCode, kind, callStart);
    if (spec !== null) {
      specs.push(spec);
    }
  }

  return specs;
};

export const collectTrailIds = (sourceCode: string): ReadonlySet<string> =>
  new Set(findTrailLikeSpecs(sourceCode).map((spec) => spec.id));

export const parseZodObjectShape = (
  schemaText: string
): ReadonlyMap<string, SchemaFieldInfo> => {
  const args = findCallArguments(schemaText, /\bz\.object\s*\(/);
  const shapeEntry = args === null ? null : firstEntry(args);
  if (!shapeEntry || !shapeEntry.text.trim().startsWith('{')) {
    return new Map();
  }

  const shape = parseObjectProperties(shapeEntry.text, 0, shapeEntry.text);
  return new Map(
    [...shape.entries()].map(([key, property]) => [
      key,
      toSchemaFieldInfo(key, property),
    ])
  );
};
