/**
 * Structured input channels for CLI commands.
 *
 * These helpers keep JSON/file/stdin parsing and merge precedence out of the
 * command builder so the behavior stays easy to test and reason about.
 */

import { ValidationError, isPlainObject } from '@ontrails/core';
import type { z } from 'zod';

import type { CliFlag } from './command.js';

/**
 * Label used in error messages when the inline-JSON positional argument is
 * involved. Kept here so the structured-input source taxonomy stays in one
 * place.
 */
export const POSITIONAL_INLINE_JSON_LABEL = '<inline-json>';

interface ZodInternals {
  readonly _zod: {
    readonly def: Readonly<Record<string, unknown>>;
  };
}

export const STRUCTURED_INPUT_HINT =
  'Use --input <path|-> or --input-json for full structured input.';

export const structuredInputPreset = (): CliFlag[] => [
  {
    description:
      'Path to a JSON file (or `-` for stdin) to merge before explicit positional args and flags',
    name: 'input',
    required: true,
    type: 'string',
    variadic: false,
  },
  {
    description:
      'JSON object to merge before explicit positional args and flags',
    name: 'input-json',
    required: true,
    type: 'string',
    variadic: false,
  },
];

/** Convert a kebab-case string to camelCase. */
export const kebabToCamel = (str: string): string =>
  str.replaceAll(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());

export const normalizeParsedFlags = (
  parsedFlags: Record<string, unknown>
): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsedFlags)) {
    normalized[kebabToCamel(key)] = value;
  }
  return normalized;
};

const getObjectShape = (
  schema: z.ZodType
): Record<string, ZodInternals> | undefined => {
  const zod = schema as unknown as ZodInternals;
  if ((zod._zod.def['type'] as string) !== 'object') {
    return undefined;
  }
  return zod._zod.def['shape'] as Record<string, ZodInternals> | undefined;
};

export const supportsStructuredInput = (schema: z.ZodType): boolean => {
  const shape = getObjectShape(schema);
  return shape !== undefined && Object.keys(shape).length > 0;
};

export const hasStructuredOnlyFields = (
  schema: z.ZodType,
  derivedFieldCount: number
): boolean => {
  const shape = getObjectShape(schema);
  return shape !== undefined && Object.keys(shape).length > derivedFieldCount;
};

interface StructuredInputReaders {
  readonly readFileText?: ((path: string) => Promise<string>) | undefined;
  readonly readStdinText?: (() => Promise<string>) | undefined;
}

type StructuredSource =
  | { readonly kind: 'input'; readonly value: string }
  | { readonly kind: 'input-json'; readonly value: string }
  | { readonly kind: 'positional'; readonly value: Record<string, unknown> };

const resolveOptionalStringFlag = (
  flags: Record<string, unknown>,
  key: 'input' | 'inputJson',
  label: '--input' | '--input-json'
): string | undefined => {
  const value = flags[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${label} requires a value`);
  }
  return value;
};

const resolveStructuredSources = (
  flags: Record<string, unknown>
): StructuredSource[] => {
  const sources: StructuredSource[] = [];
  const input = resolveOptionalStringFlag(flags, 'input', '--input');
  const inputJson = resolveOptionalStringFlag(
    flags,
    'inputJson',
    '--input-json'
  );

  if (input !== undefined) {
    sources.push({ kind: 'input', value: input });
  }
  if (inputJson !== undefined) {
    sources.push({ kind: 'input-json', value: inputJson });
  }

  return sources;
};

const parseStructuredObject = (
  raw: string,
  sourceLabel: '--input-json' | '--input'
): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`Invalid JSON for ${sourceLabel}: ${message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new ValidationError(
      `${sourceLabel} must provide a JSON object at the top level`
    );
  }

  return parsed;
};

const readStdinText = async (): Promise<string> => {
  if (process.stdin.isTTY ?? false) {
    throw new ValidationError(
      '--input - was provided but no piped input is available on stdin'
    );
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const readStructuredStdin = async (
  readers?: StructuredInputReaders
): Promise<Record<string, unknown>> => {
  const read = readers?.readStdinText ?? readStdinText;
  const contents = await read();
  if (contents.trim().length === 0) {
    throw new ValidationError(
      '--input - was provided but no JSON payload was read from stdin'
    );
  }
  return parseStructuredObject(contents, '--input');
};

const readStructuredPath = async (
  path: string,
  readers?: StructuredInputReaders
): Promise<Record<string, unknown>> => {
  if (path === '-') {
    return await readStructuredStdin(readers);
  }
  const read =
    readers?.readFileText ?? ((filePath: string) => Bun.file(filePath).text());
  const contents = await read(path);
  return parseStructuredObject(contents, '--input');
};

const readStructuredSource = async (
  source: StructuredSource,
  readers?: StructuredInputReaders
): Promise<Record<string, unknown>> => {
  switch (source.kind) {
    case 'input': {
      return await readStructuredPath(source.value, readers);
    }
    case 'input-json': {
      return parseStructuredObject(source.value, '--input-json');
    }
    case 'positional': {
      return source.value;
    }
    default: {
      throw new ValidationError('Unsupported structured input source');
    }
  }
};

/**
 * Read structured input from a JSON, file, or stdin source.
 *
 * Accepts both raw kebab-case and pre-normalized camelCase flag records —
 * normalization is idempotent so callers need not pre-process.
 */
export const readStructuredInput = async (
  parsedFlags: Record<string, unknown>,
  readers?: StructuredInputReaders
): Promise<Record<string, unknown>> => {
  const flags = normalizeParsedFlags(parsedFlags);
  const sources = resolveStructuredSources(flags);

  if (sources.length === 0) {
    return {};
  }

  if (sources.length > 1) {
    throw new ValidationError(
      'Use only one structured input source at a time: --input or --input-json'
    );
  }

  const [source] = sources;
  if (!source) {
    return {};
  }
  return await readStructuredSource(source, readers);
};

/**
 * Parse a positional inline-JSON argument as a top-level JSON object.
 *
 * Returns `undefined` when the value is not a non-empty string, so callers can
 * branch cleanly on "no positional given".
 */
export const parsePositionalInlineJson = (
  value?: unknown
): Record<string, unknown> | undefined => {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(
      `Invalid JSON for ${POSITIONAL_INLINE_JSON_LABEL}: ${message}`
    );
  }
  if (!isPlainObject(parsed)) {
    throw new ValidationError(
      `${POSITIONAL_INLINE_JSON_LABEL} must provide a JSON object at the top level`
    );
  }
  return parsed;
};

/**
 * Resolve a structured-input payload from flags or a positional
 * inline-JSON argument.
 *
 * Returns the parsed object plus a flag indicating whether any structured
 * source contributed (used to suppress the structured-input hint when the
 * caller already used one). Throws when more than one source was provided so
 * conflicts surface early at the surface boundary.
 */
export interface ResolvedStructuredInput {
  readonly payload: Record<string, unknown> | undefined;
  readonly used: boolean;
}

export const resolveStructuredInput = async (
  parsedFlags: Record<string, unknown>,
  positionalValue?: unknown,
  readers?: StructuredInputReaders
): Promise<ResolvedStructuredInput> => {
  const flags = normalizeParsedFlags(parsedFlags);
  const sources = resolveStructuredSources(flags);
  const positional = parsePositionalInlineJson(positionalValue);

  const totalSources = sources.length + (positional === undefined ? 0 : 1);

  if (totalSources === 0) {
    return { payload: undefined, used: false };
  }

  if (totalSources > 1) {
    throw new ValidationError(
      'Use only one structured input source at a time: --input, --input-json, or the positional inline-JSON argument'
    );
  }

  if (positional !== undefined) {
    return { payload: positional, used: true };
  }

  const [source] = sources;
  if (!source) {
    return { payload: undefined, used: false };
  }
  return {
    payload: await readStructuredSource(source, readers),
    used: true,
  };
};
