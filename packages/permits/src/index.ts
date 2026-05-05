export {
  authConnectorSchema,
  authErrorSchema,
  type AuthConnector,
  type AuthError,
} from './connectors/connector.js';
export {
  createJwtConnector,
  type JwtAlgorithm,
  type JwtConnectorOptions,
} from './connectors/jwt.js';
export { authResource } from './auth-resource.js';
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
export { validatePermits, type PermitDiagnostic } from './rules.js';
