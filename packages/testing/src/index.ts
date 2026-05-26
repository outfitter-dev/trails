// Contract-driven testing
export { testAll } from './all.js';
export { testExamples } from './examples.js';
export { testComposes } from './composes.js';
export { testTrail } from './trail.js';
export { testContracts } from './contracts.js';
export { testDetours } from './detours.js';

// Assertions
export {
  assertErrorMatch,
  assertFullMatch,
  assertPartialMatch,
  assertSchemaMatch,
  errResultMatch,
  expectErr,
  expectOk,
  okResultMatch,
} from './assertions.js';

// Scenario testing
export { executeScenarioSteps, ref, scenario } from './scenario.js';

// Mock factories
export {
  createComposeContext,
  createTestContext,
  defaultCreatePermit,
} from './context.js';
export { createTestLogger } from './logger.js';

// Types
export type { CreateComposeContextOptions } from './context.js';
export type {
  PermittedTrail,
  MinimalPermit,
  TestExecutionOptions,
} from './context.js';
export type { TestComposeOptions } from './composes.js';

export type {
  ComposeScenario,
  RefToken,
  ScenarioStep,
  TestScenario,
  TestLogger,
  TestTrailContextOptions,
} from './types.js';
