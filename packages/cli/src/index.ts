// Command model
export type { AnyTrail, CliCommand, CliFlag, CliArg } from './command.js';

// Build
export { deriveCliCommands } from './build.js';
export type { DeriveCliCommandsOptions, ActionResultContext } from './build.js';
export { validateCliCommands } from './validate.js';

// Flags
export {
  deriveFlags,
  outputModePreset,
  cwdPreset,
  dryRunPreset,
} from './flags.js';

// Output
export { output, deriveOutputMode } from './output.js';
export type { OutputMode } from './output.js';

// onResult
export { defaultOnResult } from './on-result.js';

// Prompt
export { passthroughResolver, isInteractive } from './prompt.js';
export type { Field, InputResolver, ResolveInputOptions } from './prompt.js';

// Discovery
export { findAppModuleCandidates, findAppModule } from './discover.js';

// Layers
export { autoIterateLayer, dateShortcutsLayer } from './layers.js';

// Surface helpers (also available from @ontrails/cli/commander)
export { createProgram, surface } from './commander/surface.js';
export type {
  CreateProgramOptions,
  SurfaceCliResult,
} from './commander/surface.js';
