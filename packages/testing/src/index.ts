// Contract-driven testing
export { testAll } from './all.js';
export { testExamples } from './examples.js';
export { testCrosses } from './crosses.js';
export { testTrail } from './trail.js';
export { testContracts } from './contracts.js';
export { testDetours } from './detours.js';

// Assertions
export {
  assertErrorMatch,
  assertFullMatch,
  assertSchemaMatch,
  expectErr,
  expectOk,
} from './assertions.js';

// Mock factories
export {
  createCrossContext,
  createTestContext,
  defaultMintPermit,
} from './context.js';
export { createTestLogger } from './logger.js';

// Trailhead harnesses
export { createCliHarness } from './harness-cli.js';
export { createMcpHarness } from './harness-mcp.js';

// Types
export type { CreateCrossContextOptions } from './context.js';
export type {
  MintableTrail,
  MintedPermit,
  TestExecutionOptions,
} from './context.js';
export type { TestCrossOptions } from './crosses.js';

export type {
  CrossScenario,
  TestScenario,
  TestLogger,
  TestTrailContextOptions,
  CliHarness,
  CliHarnessOptions,
  CliHarnessResult,
  McpHarness,
  McpHarnessOptions,
  McpHarnessResult,
} from './types.js';
