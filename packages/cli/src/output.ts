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
// resolveOutputMode()
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

/** Resolve mode from environment variables. */
const resolveEnvMode = (): OutputMode | undefined => {
  if (process.env['TRAILS_JSON'] === '1') {
    return 'json';
  }
  if (process.env['TRAILS_JSONL'] === '1') {
    return 'jsonl';
  }
  return undefined;
};

/**
 * Determine the output mode from parsed CLI flags and environment.
 *
 * Resolution order (highest priority wins):
 * 1. `flags.json === true` -> "json"
 * 2. `flags.jsonl === true` -> "jsonl"
 * 3. `flags.output` as string -> validate against OutputMode
 * 4. `TRAILS_JSON=1` env var -> "json"
 * 5. `TRAILS_JSONL=1` env var -> "jsonl"
 * 6. Default: "text"
 */
export const resolveOutputMode = (
  flags: Record<string, unknown>
): {
  mode: OutputMode;
} => {
  const mode = resolveFlagMode(flags) ?? resolveEnvMode() ?? 'text';
  return { mode };
};
