/**
 * Shared vocabulary for projecting layer input fields onto surface parameters.
 *
 * Layer input is authored once on `Layer.input`, then rendered by CLI, MCP, and
 * HTTP surfaces. Reserved names live here so a layer field that conflicts with
 * framework-owned surface parameters is renamed consistently everywhere.
 */

export const LAYER_FIELD_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'all',
  'devPermit',
  'dryRun',
  'input',
  'inputJson',
  'json',
  'jsonl',
  'output',
  'permit',
  'quiet',
  'token',
  'trace',
  'watch',
]);
