// Contract-driven testing
export { testAll } from './all.js';
export { testExamples } from './examples.js';
export { testFollows } from './follows.js';
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
export { createTestContext } from './context.js';
export { createTestLogger } from './logger.js';

// Surface harnesses
export { createCliHarness } from './harness-cli.js';
export { createMcpHarness } from './harness-mcp.js';

// Types
export type { TestFollowOptions } from './follows.js';

export type {
  FollowScenario,
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
