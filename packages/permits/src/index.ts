export {
  authAdapterSchema,
  authErrorSchema,
  type AuthAdapter,
  type AuthError,
} from './adapters/adapter.js';
export {
  createJwtAdapter,
  type JwtAlgorithm,
  type JwtAdapterOptions,
} from './adapters/jwt.js';
export {
  authResource,
  authResourceConfigSchema,
  type AuthResourceConfig,
} from './auth-resource.js';
export {
  AUTH_RESOURCE_ID,
  resolvePermitFromBearerToken,
  type ResolvePermitFromBearerTokenOptions,
} from './boundary.js';
export { authVerify } from './trails/auth-verify.js';
export { PermitError } from './errors.js';
export {
  permitExtractionInputSchema,
  type PermitExtractionInput,
} from './extraction.js';
export { type Permit, getPermit } from './permit.js';
export {
  validatePermits,
  type PermitDiagnostic,
  type PermitDiagnosticSeverity,
} from './rules.js';
