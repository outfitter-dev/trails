// Command model
export type { AnyTrail, CliCommand, CliFlag, CliArg } from './command.js';

// Build
export { buildCliCommands } from './build.js';
export type { BuildCliCommandsOptions, ActionResultContext } from './build.js';
export { validateCliCommands } from './validate.js';

// Flags
export {
  deriveFlags,
  outputModePreset,
  cwdPreset,
  dryRunPreset,
} from './flags.js';

// Output
export { output, resolveOutputMode } from './output.js';
export type { OutputMode } from './output.js';

// onResult
export { defaultOnResult } from './on-result.js';

// Prompt
export { passthroughResolver, isInteractive } from './prompt.js';
export type { Field, InputResolver, ResolveInputOptions } from './prompt.js';

// Gates
export { autoIterateGate, dateShortcutsGate } from './gates.js';
