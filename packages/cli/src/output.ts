/**
 * Output formatting and mode resolution for CLI output.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputMode = 'text' | 'json' | 'jsonl';

// ---------------------------------------------------------------------------
// output()
// ---------------------------------------------------------------------------

/**
 * Write a value to stdout in the specified format.
 *
 * - **text**: strings written directly; objects JSON-stringified with 2-space indent
 * - **json**: always JSON.stringify with 2-space indent
 * - **jsonl**: arrays emit one JSON line per element; scalars emit one line
 */
const outputWriters: Record<OutputMode, (value: unknown) => void> = {
  json: (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`),
  jsonl: (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        process.stdout.write(`${JSON.stringify(item)}\n`);
      }
    } else {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    }
  },
  text: (value) => {
    if (typeof value === 'string') {
      process.stdout.write(`${value}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    }
  },
};

export const output = (value: unknown, mode: OutputMode): void => {
  const writer = outputWriters[mode];
  writer(value);
};

// ---------------------------------------------------------------------------
// deriveOutputMode()
// ---------------------------------------------------------------------------

const VALID_MODES = new Set<OutputMode>(['text', 'json', 'jsonl']);

/** Resolve mode from flags alone (--json, --jsonl, --output). */
const resolveFlagMode = (
  flags: Record<string, unknown>
): OutputMode | undefined => {
  if (flags['json'] === true) {
    return 'json';
  }
  if (flags['jsonl'] === true) {
    return 'jsonl';
  }
  if (
    typeof flags['output'] === 'string' &&
    VALID_MODES.has(flags['output'] as OutputMode)
  ) {
    return flags['output'] as OutputMode;
  }
  return undefined;
};

/**
 * Convert a topo name into the env var prefix used for per-topo output mode.
 *
 * Derivation rules:
 * - Uppercased
 * - Non-alphanumerics replaced with `_`
 * - Leading digits prefixed with `_` so the result is a valid identifier
 */
const topoNameToEnvPrefix = (topoName: string): string => {
  const normalized = topoName.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_');
  return /^\d/.test(normalized) ? `_${normalized}` : normalized;
};

/** Resolve mode from topo-derived environment variables. */
const resolveEnvMode = (topoName: string): OutputMode | undefined => {
  const prefix = topoNameToEnvPrefix(topoName);
  if (process.env[`${prefix}_JSON`] === '1') {
    return 'json';
  }
  if (process.env[`${prefix}_JSONL`] === '1') {
    return 'jsonl';
  }
  return undefined;
};

/**
 * Determine the output mode from parsed CLI flags and topo-derived env vars.
 *
 * Resolution order (highest priority wins):
 * 1. `flags.json === true` -> "json"
 * 2. `flags.jsonl === true` -> "jsonl"
 * 3. `flags.output` as string -> validate against OutputMode
 * 4. `<TOPO>_JSON=1` env var -> "json"
 * 5. `<TOPO>_JSONL=1` env var -> "jsonl"
 * 6. Default: "text"
 *
 * `<TOPO>` is derived from the topo name per ADR-0023: uppercased, with
 * non-alphanumerics replaced by underscores. A topo named `stash` reads
 * `STASH_JSON` / `STASH_JSONL`.
 */
export const deriveOutputMode = (
  flags: Record<string, unknown>,
  topoName: string
): {
  mode: OutputMode;
} => {
  const mode = resolveFlagMode(flags) ?? resolveEnvMode(topoName) ?? 'text';
  return { mode };
};
