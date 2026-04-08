export {
  appConfig,
  type AppConfig,
  type AppConfigExplainOptions,
  type AppConfigOptions,
  type ConfigFormat,
  type ResolveOptions,
} from './app-config.js';
export { collectConfigMeta } from './collect.js';
export {
  collectProvisionConfigs,
  collectServiceConfigs,
  type ProvisionConfigEntry,
  type ServiceConfigEntry,
} from './compose.js';
export { defineConfig, type DefineConfigOptions } from './define-config.js';
export { describeConfig, type FieldDescription } from './describe.js';
export {
  checkConfig,
  type CheckResult,
  type ConfigDiagnostic,
} from './doctor.js';
export { env, secret, deprecated, type ConfigFieldMeta } from './extensions.js';
export {
  explainConfig,
  type ExplainConfigOptions,
  type ProvenanceEntry,
} from './explain.js';
export {
  generateEnvExample,
  generateExample,
  generateJsonSchema,
} from './generate/index.js';
export { configGate } from './config-layer.js';
export { configResource } from './config-resource.js';
export {
  clearConfigState,
  type ConfigState,
  getConfigState,
  registerConfigState,
} from './registry.js';
export { deepMerge } from './merge.js';
export { configRef, isConfigRef, type ConfigRef } from './ref.js';
export { resolveConfig, type ResolveConfigOptions } from './resolve.js';
export { configCheck } from './trails/config-check.js';
export { configDescribe } from './trails/config-describe.js';
export { configExplain } from './trails/config-explain.js';
export { configInit } from './trails/config-init.js';
export { ensureWorkspace } from './workspace.js';
