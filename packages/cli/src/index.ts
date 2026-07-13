// Command model
export type {
  AnyTrail,
  CliCommand,
  CliCommandExecuteOptions,
  CliFlag,
  CliArg,
  CliFlagValueAlias,
} from './command.js';
export { normalizeCliArgv } from './argv.js';

// Build
export { deriveCliCommands } from './build.js';
export type {
  ActionResultContext,
  DeriveCliCommandsOptions,
  ResolveCliPermitFromToken,
  ResolveCliPermitFromTokenInput,
} from './build.js';
export { validateCliCommands } from './validate.js';
export { deriveCliSchema, findCliSchemaCommand } from './schema.js';
export type {
  CliCommandSchemaEntry,
  CliCommandSchemaRoute,
  CliSchemaIndex,
} from './schema.js';

// Flags
export {
  applyCliFlagValueAliases,
  deriveCliFlagValueAliases,
  deriveFlags,
  outputModePreset,
  cwdPreset,
  devPermitPreset,
  dryRunPreset,
  permitPreset,
  tokenPreset,
  tracePreset,
  watchPreset,
} from './flags.js';
export type { CliFlagValueAliasDeclaration } from './flags.js';

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
