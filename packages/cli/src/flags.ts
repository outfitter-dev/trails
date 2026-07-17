/**
 * Flag derivation from surface-agnostic fields and reusable flag presets.
 */

import { ValidationError, deriveFields } from '@ontrails/core';
import type { Field, FieldOverride } from '@ontrails/core';
import type { z } from 'zod';

import type { CliFlag, CliFlagValueAlias } from './command.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert camelCase to kebab-case. */
const toKebab = (str: string): string =>
  str.replaceAll(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

const toCamel = (str: string): string =>
  str.replaceAll(/-([a-zA-Z0-9])/g, (_, ch: string) => ch.toUpperCase());

interface CliFlagShape {
  readonly choices?: string[] | undefined;
  readonly type: CliFlag['type'];
  readonly variadic: boolean;
}

interface CliFlagValueAliasSpec {
  readonly description?: string | undefined;
  readonly name: string;
}

export type CliFlagValueAliasDeclaration =
  | true
  | Readonly<Record<string, string | CliFlagValueAliasSpec>>;

interface CliFieldOverride extends FieldOverride {
  readonly aliases?: CliFlagValueAliasDeclaration | undefined;
}

const fieldTypeToCliFlag: Record<Field['type'], CliFlagShape> = {
  boolean: { type: 'boolean', variadic: false },
  enum: { type: 'string', variadic: false },
  multiselect: { type: 'string[]', variadic: false },
  number: { type: 'number', variadic: false },
  'number[]': { type: 'number[]', variadic: true },
  string: { type: 'string', variadic: false },
  'string[]': { type: 'string[]', variadic: true },
};

const renderFlagName = (flagName: string): string => `--${flagName}`;

const validateAliasName = (flagName: string, aliasName: string): void => {
  if (aliasName.trim().length === 0) {
    throw new ValidationError(
      `CLI flag alias for ${renderFlagName(flagName)} cannot be empty`
    );
  }
};

const validateAliasValue = (
  flagName: string,
  value: string,
  choices: readonly string[]
): void => {
  if (!choices.includes(value)) {
    throw new ValidationError(
      `CLI flag alias for ${renderFlagName(flagName)} targets unknown value "${value}". Expected one of: ${choices.join(', ')}.`
    );
  }
};

const normalizeAliasSpec = (
  flagName: string,
  choices: readonly string[],
  value: string,
  spec: string | CliFlagValueAliasSpec
): CliFlagValueAlias => {
  validateAliasValue(flagName, value, choices);
  const alias =
    typeof spec === 'string' ? { name: spec } : { ...spec, name: spec.name };
  validateAliasName(flagName, alias.name);
  return { ...alias, value };
};

/**
 * Resolve explicit value aliases for enum-style CLI flags.
 *
 * @example
 * ```ts
 * import { deriveCliFlagValueAliases } from '@ontrails/cli';
 *
 * const aliases = deriveCliFlagValueAliases({
 *   aliases: {
 *     json: { description: 'JSON output', name: 'json' },
 *     jsonl: 'jsonl',
 *   },
 *   choices: ['text', 'json', 'jsonl'],
 *   flagName: 'output',
 * });
 * ```
 */
export const deriveCliFlagValueAliases = ({
  aliases,
  choices,
  flagName,
}: {
  readonly aliases?: CliFlagValueAliasDeclaration | undefined;
  readonly choices: readonly string[];
  readonly flagName: string;
}): readonly CliFlagValueAlias[] | undefined => {
  if (aliases === undefined) {
    return undefined;
  }

  if (aliases === true) {
    return choices.map((value) =>
      normalizeAliasSpec(flagName, choices, value, value)
    );
  }

  return Object.entries(aliases).map(([value, spec]) =>
    normalizeAliasSpec(flagName, choices, value, spec)
  );
};

/** Convert a derived field into a CLI flag descriptor. */
const toCliFlag = (
  field: Field,
  override?: CliFieldOverride | undefined
): CliFlag => {
  const shape = fieldTypeToCliFlag[field.type];
  const choices = field.options?.map((option) => option.value);
  if (override?.aliases !== undefined && choices === undefined) {
    throw new ValidationError(
      `CLI flag alias for ${renderFlagName(toKebab(field.name))} requires enum choices`
    );
  }
  return {
    choices,
    default: field.default,
    description: field.label,
    name: toKebab(field.name),
    required: field.required,
    type: shape.type,
    valueAliases:
      choices === undefined
        ? undefined
        : deriveCliFlagValueAliases({
            aliases: override?.aliases,
            choices,
            flagName: toKebab(field.name),
          }),
    variadic: shape.variadic,
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Convert derived fields to CLI flags. */
export const toFlags = (
  fields: readonly Field[],
  overrides?: Readonly<Record<string, CliFieldOverride>> | undefined
): CliFlag[] =>
  fields.map((field) => toCliFlag(field, overrides?.[field.name]));

/**
 * Derive CLI flags from a Zod input schema.
 *
 * @example
 * ```ts
 * import { deriveFlags } from '@ontrails/cli';
 * import { z } from 'zod';
 *
 * const flags = deriveFlags(
 *   z.object({ format: z.enum(['summary', 'json']) }),
 *   { format: { aliases: { json: 'json' } } }
 * );
 * ```
 */
export const deriveFlags = (
  schema: z.ZodType,
  overrides?: Readonly<Record<string, CliFieldOverride>> | undefined
): CliFlag[] => toFlags(deriveFields(schema, overrides), overrides);

/**
 * Normalize value aliases back onto canonical flag keys.
 *
 * @example
 * ```ts
 * import { applyCliFlagValueAliases, deriveFlags } from '@ontrails/cli';
 * import { z } from 'zod';
 *
 * const flags = deriveFlags(z.object({ output: z.enum(['json', 'text']) }), {
 *   output: { aliases: { json: 'json' } },
 * });
 *
 * const normalized = applyCliFlagValueAliases(flags, {
 *   output: 'text',
 *   json: true,
 * });
 * // { output: 'json' }
 * ```
 */
export const applyCliFlagValueAliases = (
  flags: readonly CliFlag[],
  parsedFlags: Readonly<Record<string, unknown>>,
  userSuppliedFlagKeys?: ReadonlySet<string> | undefined
): Record<string, unknown> => {
  const aliasKeys = new Set(
    flags.flatMap((flag) =>
      (flag.valueAliases ?? []).map((alias) => toCamel(alias.name))
    )
  );
  const normalized = Object.fromEntries(
    Object.entries(parsedFlags).filter(([key]) => !aliasKeys.has(key))
  );

  for (const flag of flags) {
    const aliases = flag.valueAliases ?? [];
    const activeAliases = aliases.filter(
      (alias) => parsedFlags[toCamel(alias.name)] === true
    );
    if (activeAliases.length === 0) {
      continue;
    }
    if (activeAliases.length > 1) {
      throw new ValidationError(
        `CLI flag "--${flag.name}" received multiple value aliases: ${activeAliases.map((alias) => `--${alias.name}`).join(', ')}`
      );
    }

    const canonicalKey = toCamel(flag.name);
    // Adapters should pass the exact user-supplied key set when they preserve
    // defaulted canonical values in parsed flags. Without that set, an active
    // value alias plus any parsed canonical key is ambiguous and must fail
    // loudly instead of guessing whether the canonical value was a default.
    const canonicalWasSupplied =
      userSuppliedFlagKeys?.has(canonicalKey) ??
      Object.hasOwn(normalized, canonicalKey);
    const [activeAlias] = activeAliases;
    if (!activeAlias) {
      continue;
    }
    if (canonicalWasSupplied) {
      throw new ValidationError(
        `CLI flag "--${flag.name}" cannot be combined with value alias "--${activeAlias.name}"`
      );
    }

    normalized[canonicalKey] = activeAlias.value;
  }

  return normalized;
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Flags for output mode selection: --output, --json, --jsonl, --quiet
 *
 * @example
 * ```ts
 * import { outputModePreset } from '@ontrails/cli';
 *
 * const flagNames = outputModePreset().map((flag) => flag.name);
 * // [ 'output', 'json', 'jsonl', 'quiet' ]
 * ```
 */
export const outputModePreset = (): CliFlag[] => [
  {
    choices: ['text', 'json', 'jsonl'],
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

/**
 * Flag for working directory override: --cwd
 *
 * @example
 * ```ts
 * import { cwdPreset } from '@ontrails/cli';
 *
 * const [cwd] = cwdPreset();
 * // cwd.name === 'cwd'
 * ```
 */
export const cwdPreset = (): CliFlag[] => [
  {
    description: 'Working directory override',
    name: 'cwd',
    required: false,
    type: 'string',
    variadic: false,
  },
];

/**
 * Flag for dry-run mode: --dry-run
 *
 * @example
 * ```ts
 * import { dryRunPreset } from '@ontrails/cli';
 *
 * const [dryRun] = dryRunPreset();
 * // dryRun.name === 'dry-run'
 * ```
 */
export const dryRunPreset = (): CliFlag[] => [
  {
    description: 'Execute without side effects',
    name: 'dry-run',
    required: false,
    type: 'boolean',
    variadic: false,
  },
];

/** Flag for selecting a live trail version: --trail-version */
export const trailVersionPreset = (): CliFlag[] => [
  {
    description: 'Execute a live trail version by number or marker prefix',
    name: 'trail-version',
    required: false,
    type: 'string',
    variadic: false,
  },
];

/**
 * Flag for trace collection: --trace
 *
 * When set, the CLI installs a per-invocation in-memory trace sink, renders
 * the resulting trace tree to stderr after execution, and (under `--json`)
 * includes the structured `TraceRecord[]` on the stdout envelope. The flag
 * is treated as a meta flag — it never flows into trail input.
 *
 * @example
 * ```ts
 * import { tracePreset } from '@ontrails/cli';
 *
 * const [trace] = tracePreset();
 * // trace.name === 'trace'
 * ```
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
 * `ValidationError`. The flag is treated as a meta flag — it never flows
 * into trail input.
 *
 * Mutually exclusive with `--token`; passing both surfaces a
 * `ValidationError`.
 *
 * @example
 * ```ts
 * import { permitPreset } from '@ontrails/cli';
 *
 * const [permit] = permitPreset();
 * // permit.name === 'permit'
 * ```
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
 * `ValidationError`. The flag is treated as a meta flag — it never flows
 * into trail input.
 *
 * @example
 * ```ts
 * import { tokenPreset } from '@ontrails/cli';
 *
 * const [token] = tokenPreset();
 * // token.name === 'token'
 * ```
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
 * `SIGINT`. The flag is treated as a meta flag — it never flows into
 * trail input.
 *
 * `--watch` is local-development ergonomics only and is implemented in
 * the `apps/trails` binary's `run` entrypoint, not in surface-agnostic
 * trail code. Other surfaces (MCP, HTTP) ignore the flag.
 *
 * @example
 * ```ts
 * import { watchPreset } from '@ontrails/cli';
 *
 * const [watch] = watchPreset();
 * // watch.name === 'watch'
 * ```
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
 * never flows into trail input.
 *
 * @example
 * ```ts
 * import { devPermitPreset } from '@ontrails/cli';
 *
 * const [devPermit] = devPermitPreset();
 * // devPermit.name === 'dev-permit'
 * ```
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
