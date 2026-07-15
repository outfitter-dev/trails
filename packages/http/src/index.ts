// Build (framework-agnostic)
export {
  deriveHttpRoutes,
  type DeriveHttpRoutesOptions,
  type HttpExecutionContext,
  type HttpHeaderSource,
  type HttpLayerInputRendering,
  type HttpRouteDefinition,
  type ResolveHttpPermit,
  type ResolveHttpPermitInput,
} from './build.js';
export {
  deriveHttpInputSource,
  deriveHttpMethod,
  deriveHttpOperationMethod,
  httpMethodByIntent,
} from './method.js';
export type { HttpMethod, HttpOperationMethod, InputSource } from './method.js';
export {
  createFetchHandler,
  createRouteHandler,
  type CreateFetchHandlerOptions,
  type CreateRouteHandlerOptions,
} from './fetch.js';

// OpenAPI
export { deriveOpenApiSpec } from './openapi.js';
export type { OpenApiOptions, OpenApiSpec, OpenApiServer } from './openapi.js';
