# Portable sources

- Launch handoff: <https://linear.app/outfitter/document/trails-six-lane-campaign-launch-handoffs-and-chat-directory-2026-10-28-7f63d5af3a17>
- Operating plan: <https://linear.app/outfitter/document/trails-six-lane-campaign-operating-plan-and-decisions-2026-10-28-54fec3988899>
- Inventory: <https://linear.app/outfitter/document/trails-six-lane-campaign-approved-issue-inventory-2026-10-28-103b20d062de>
- First acceptance: <https://linear.app/outfitter/issue/TRL-1416/make-createcliharness-honor-registered-cli-flags-and-reject-unknown>
- Project P-TRL-105; milestone 992e4476-133f-4fc7-9a2c-2f4861dcca9c.

## Baseline defect evidence at 34d7f6e14

- packages/testing/src/harness-cli.ts:16-19: `'onResult' | 'presets' | 'resolveInput'` excluded from options.
- packages/testing/src/harness-cli.ts:113-121: `const key = token.slice(2);` then direct assignment; no registered-name validation.
- packages/testing/src/harness-cli.ts:199-200: output/json special handling.
- packages/testing/src/surface-parity.ts:99: `return`${path} --input-json ${inputJson} --output json`;`
- packages/cli/src/build.ts:119: `presets?: readonly (readonly CliFlag[])[] | undefined;`
- packages/cli/src/build.ts:1184-1185: merges configured presets into derived flags.
- adapters/commander/src/to-commander.ts:873-875: iterates cmd.flags and registers buildOptions(flag).
- packages/cli/src/flags.ts:274-303: outputModePreset owns output/json/jsonl/quiet registrations.
- packages/testing/src/**tests**/harness-cli.test.ts:80-87: harness without presets runs --output json.
- docs/testing.md:362-363 and packages/testing/README.md:108-109: same unregistered output flag taught.
- docs/adr/0020-flags-for-fields-structured-input-on-the-cli.md:120: current preset mechanism retained; globals formalization deferred.

## Current implementation owners

- packages/testing/src/harness-cli.ts:17-20 retains presets in CliHarnessOptions.
- packages/testing/src/harness-cli.ts:148 uses `output(value, deriveOutputMode(flags, topoName).mode);` from the CLI owner.
- packages/testing/src/harness-cli-argv.ts:109 reuses `normalizeCliArgv` before registered flag parsing.
- packages/testing/src/harness-cli-argv.ts:126-128 throws `ValidationError` when `findFlag` cannot resolve the current option.
- packages/testing/src/surface-parity.ts:100-101 omits structured input for empty examples; :249 explicitly installs outputModePreset for its internal CLI.
- packages/testing/src/**tests**/harness-cli.test.ts compares the harness to the actual Commander surface subprocess for output preset disabled/enabled, unknown/short/attached/grouped flags, boolean negation, variadic and bounded arrays, JSON and JSONL; successful stdout is compared exactly.
