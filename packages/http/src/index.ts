// Build (framework-agnostic)
export {
  deriveHttpRoutes,
  type DeriveHttpRoutesOptions,
  type HttpRouteDefinition,
} from './build.js';
export {
  deriveHttpInputSource,
  deriveHttpMethod,
  deriveHttpOperationMethod,
  httpMethodByIntent,
} from './method.js';
export type { HttpMethod, HttpOperationMethod, InputSource } from './method.js';

// OpenAPI
export { deriveOpenApiSpec } from './openapi.js';
export type { OpenApiOptions, OpenApiSpec, OpenApiServer } from './openapi.js';
