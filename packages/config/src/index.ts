export {
  appConfig,
  type AppConfig,
  type AppConfigExplainOptions,
  type AppConfigOptions,
  type ConfigFormat,
  type ResolveOptions,
} from './app-config.js';
export { collectConfigMeta } from './collect.js';
export { collectServiceConfigs, type ServiceConfigEntry } from './compose.js';
export { defineConfig, type DefineConfigOptions } from './define-config.js';
export { env, secret, deprecated, type ConfigFieldMeta } from './extensions.js';
export {
  clearConfigState,
  type ConfigState,
  getConfigState,
  registerConfigState,
} from './registry.js';
export { deepMerge } from './merge.js';
export { resolveConfig, type ResolveConfigOptions } from './resolve.js';
export { configCheck } from './trails/config-check.js';
export { configDescribe } from './trails/config-describe.js';
