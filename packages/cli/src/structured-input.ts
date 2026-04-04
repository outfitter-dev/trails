/**
 * Structured input channels for CLI commands.
 *
 * These helpers keep JSON/file/stdin parsing and merge precedence out of the
 * command builder so the behavior stays easy to test and reason about.
 */

import { ValidationError, isPlainObject } from '@ontrails/core';
import type { z } from 'zod';

import type { CliFlag } from './command.js';

interface ZodInternals {
  readonly _zod: {
    readonly def: Readonly<Record<string, unknown>>;
  };
}

export const STRUCTURED_INPUT_HINT =
  'Use --input-json, --input-file, or --stdin for full structured input.';

export const structuredInputPreset = (): CliFlag[] => [
  {
    description:
      'JSON object to merge before explicit positional args and flags',
    name: 'input-json',
    required: true,
    type: 'string',
    variadic: false,
  },
  {
    description:
      'Path to a JSON file to merge before explicit positional args and flags',
    name: 'input-file',
    required: true,
    type: 'string',
    variadic: false,
  },
  {
    description:
      'Read a JSON object from stdin before explicit positional args and flags',
    name: 'stdin',
    required: false,
    type: 'boolean',
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
  | { readonly kind: 'input-json'; readonly value: string }
  | { readonly kind: 'input-file'; readonly value: string }
  | { readonly kind: 'stdin' };

const resolveStructuredSources = (
  flags: Record<string, unknown>
): StructuredSource[] => {
  const sources: StructuredSource[] = [];

  if (typeof flags['inputJson'] === 'string') {
    sources.push({ kind: 'input-json', value: flags['inputJson'] });
  }
  if (typeof flags['inputFile'] === 'string') {
    sources.push({ kind: 'input-file', value: flags['inputFile'] });
  }
  if (flags['stdin'] === true) {
    sources.push({ kind: 'stdin' });
  }

  return sources;
};

const parseStructuredObject = (
  raw: string,
  sourceLabel: '--input-json' | '--input-file' | '--stdin'
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
      '--stdin was provided but no piped input is available on stdin'
    );
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const readStructuredFile = async (
  path: string,
  readers?: StructuredInputReaders
): Promise<Record<string, unknown>> => {
  const read =
    readers?.readFileText ?? ((filePath: string) => Bun.file(filePath).text());
  const contents = await read(path);
  return parseStructuredObject(contents, '--input-file');
};

const readStructuredStdin = async (
  readers?: StructuredInputReaders
): Promise<Record<string, unknown>> => {
  const read = readers?.readStdinText ?? readStdinText;
  const contents = await read();
  if (contents.trim().length === 0) {
    throw new ValidationError(
      '--stdin was provided but no JSON payload was read from stdin'
    );
  }
  return parseStructuredObject(contents, '--stdin');
};

const readStructuredSource = async (
  source: StructuredSource,
  readers?: StructuredInputReaders
): Promise<Record<string, unknown>> => {
  switch (source.kind) {
    case 'input-json': {
      return parseStructuredObject(source.value, '--input-json');
    }
    case 'input-file': {
      return await readStructuredFile(source.value, readers);
    }
    case 'stdin': {
      return await readStructuredStdin(readers);
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
      'Use only one structured input source at a time: --input-json, --input-file, or --stdin'
    );
  }

  const [source] = sources;
  if (!source) {
    return {};
  }
  return await readStructuredSource(source, readers);
};
