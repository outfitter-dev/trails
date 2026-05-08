/**
 * Flag derivation from surface-agnostic fields and reusable flag presets.
 */

import { deriveFields } from '@ontrails/core';
import type { Field, FieldOverride } from '@ontrails/core';
import type { z } from 'zod';

import type { CliFlag } from './command.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert camelCase to kebab-case. */
const toKebab = (str: string): string =>
  str.replaceAll(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

interface CliFlagShape {
  readonly choices?: string[] | undefined;
  readonly type: CliFlag['type'];
  readonly variadic: boolean;
}

const fieldTypeToCliFlag: Record<Field['type'], CliFlagShape> = {
  boolean: { type: 'boolean', variadic: false },
  enum: { type: 'string', variadic: false },
  multiselect: { type: 'string[]', variadic: true },
  number: { type: 'number', variadic: false },
  'number[]': { type: 'number[]', variadic: true },
  string: { type: 'string', variadic: false },
  'string[]': { type: 'string[]', variadic: true },
};

/** Convert a derived field into a CLI flag descriptor. */
const toCliFlag = (field: Field): CliFlag => {
  const shape = fieldTypeToCliFlag[field.type];
  return {
    choices: field.options?.map((option) => option.value),
    default: field.default,
    description: field.label,
    name: toKebab(field.name),
    required: field.required,
    type: shape.type,
    variadic: shape.variadic,
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Convert derived fields to CLI flags. */
export const toFlags = (fields: readonly Field[]): CliFlag[] =>
  fields.map(toCliFlag);

/** Derive CLI flags from a Zod input schema. */
export const deriveFlags = (
  schema: z.ZodType,
  overrides?: Readonly<Record<string, FieldOverride>> | undefined
): CliFlag[] => toFlags(deriveFields(schema, overrides));

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** Flags for output mode selection: --output, --json, --jsonl, --quiet */
export const outputModePreset = (): CliFlag[] => [
  {
    choices: ['text', 'json', 'jsonl'],
    default: 'text',
    description: 'Output format',
    name: 'output',
    required: false,
    short: 'o',
    type: 'string',
    variadic: false,
  },
  {
    description: 'Shorthand for --output json',
    name: 'json',
    required: false,
    type: 'boolean',
    variadic: false,
  },
  {
    description: 'Shorthand for --output jsonl',
    name: 'jsonl',
    required: false,
    type: 'boolean',
    variadic: false,
  },
  {
    description:
      'Strip outer Result wrapper from `trails run` (pipe-friendly: value only on stdout, error message on stderr)',
    name: 'quiet',
    required: false,
    short: 'q',
    type: 'boolean',
    variadic: false,
  },
];

/** Flag for working directory override: --cwd */
export const cwdPreset = (): CliFlag[] => [
  {
    description: 'Working directory override',
    name: 'cwd',
    required: false,
    type: 'string',
    variadic: false,
  },
];

/** Flag for dry-run mode: --dry-run */
export const dryRunPreset = (): CliFlag[] => [
  {
    description: 'Execute without side effects',
    name: 'dry-run',
    required: false,
    type: 'boolean',
    variadic: false,
  },
];

/**
 * Flag for trace collection: --trace
 *
 * When set, the CLI installs a per-invocation in-memory trace sink, renders
 * the resulting trace tree to stderr after execution, and (under `--json`)
 * includes the structured `TraceRecord[]` on the stdout envelope. The flag
 * is treated as a meta flag — it never routes into trail input.
 */
export const tracePreset = (): CliFlag[] => [
  {
    default: false,
    description: 'Collect a per-invocation trace tree to stderr',
    name: 'trace',
    required: false,
    type: 'boolean',
    variadic: false,
  },
];

/**
 * Flag for inline permit JSON: --permit '<json>'
 *
 * Accepts a JSON-encoded `BasePermit` (`{ id: string; scopes: string[] }`)
 * which the CLI parses, validates, and overlays onto the trail's
 * `ctx.permit`. Failures (invalid JSON, schema mismatch) are surfaced as
 * `ValidationError`. The flag is treated as a meta flag — it never routes
 * into trail input.
 *
 * Mutually exclusive with `--token`; passing both surfaces a
 * `ValidationError`.
 */
export const permitPreset = (): CliFlag[] => [
  {
    description: 'Inline permit JSON: \'{"id":"...","scopes":["..."]}\'',
    name: 'permit',
    required: false,
    type: 'string',
    variadic: false,
  },
];

/**
 * Flag for resolving a permit through the CLI resolver: --token <value>
 *
 * The surface caller supplies `resolvePermitFromToken` to turn the token into
 * a `Permit`, which is overlaid onto `ctx.permit`. The `apps/trails` binary
 * wires this to `@ontrails/permits`; the CLI package itself stays
 * adapter-agnostic.
 *
 * Mutually exclusive with `--permit`; passing both surfaces a
 * `ValidationError`. The flag is treated as a meta flag — it never routes
 * into trail input.
 */
export const tokenPreset = (): CliFlag[] => [
  {
    description:
      'Bearer token resolved to a permit by the CLI resolver (mutually exclusive with --permit)',
    name: 'token',
    required: false,
    type: 'string',
    variadic: false,
  },
];

/**
 * Flag for live re-execution of `trails run`: --watch
 *
 * When set, the CLI runs the resolved trail once, installs a filesystem
 * watcher scoped to the trail's source file (and its sibling
 * `*.ts`/`*.js` files in the same directory), and reruns the trail
 * whenever a watched file changes. The loop runs until the user sends
 * `SIGINT`. The flag is treated as a meta flag — it never routes into
 * trail input.
 *
 * `--watch` is local-development ergonomics only and is implemented in
 * the `apps/trails` binary's `run` entrypoint, not in surface-agnostic
 * trail code. Other surfaces (MCP, HTTP) ignore the flag.
 */
export const watchPreset = (): CliFlag[] => [
  {
    default: false,
    description: 'Rerun the trail when its source file or siblings change',
    name: 'watch',
    required: false,
    type: 'boolean',
    variadic: false,
  },
];

/**
 * Flag for injecting a synthetic full-access permit: --dev-permit
 *
 * Local development only. When set, the CLI synthesizes a `BasePermit`
 * with `id: 'dev-permit'` whose `scopes` array contains every scope
 * declared by trails on the resolved topo, so any permit-protected trail
 * accepts it without configuring `--permit` or `--token`.
 *
 * The synthetic id (`'dev-permit'`) is intentionally distinctive so it
 * shows up clearly in trace records and audit logs — accidental use in
 * a non-development context is easy to grep for.
 *
 * CI and committed scripts must use `--token` or `--permit`. The Warden
 * rule `no-dev-permit-in-source` flags `--dev-permit` strings appearing
 * in committed source as a hard error so accidental check-ins fail CI.
 *
 * Mutually exclusive with `--permit` and `--token`; passing any pair
 * surfaces a `ValidationError`. The flag is treated as a meta flag — it
 * never routes into trail input.
 */
export const devPermitPreset = (): CliFlag[] => [
  {
    default: false,
    description:
      'Local development only: inject a synthetic full-access permit (mutually exclusive with --permit and --token)',
    name: 'dev-permit',
    required: false,
    type: 'boolean',
    variadic: false,
  },
];
