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
  createTokenCallbackAdapter,
  type TokenCallbackAdapterOptions,
} from './adapters/token-callback.js';
export {
  authResource,
  authResourceConfigSchema,
  type AuthResourceConfig,
} from './auth-resource.js';
export {
  AUTH_RESOURCE_ID,
  resolvePermitFromBearerToken,
  resolvePermitFromInput,
  type ResolvePermitFromInputOptions,
  type ResolvePermitFromBearerTokenOptions,
} from './boundary.js';
export { authVerify } from './trails/auth-verify.js';
export { PermitError } from './errors.js';
export {
  permitExtractionInputSchema,
  type PermitExtractionInput,
} from './extraction.js';
export { type Permit, getPermit, permitSchema } from './permit.js';
export {
  SYNTHETIC_PERMIT_ID,
  collectDeclaredScopes,
  deriveAssertedKindsPolicy,
  reconcilePermit,
  type AssertedKindsPolicy,
  type CredentialCandidate,
  type InlinePermitCandidate,
  type PermitCandidates,
  type PermitVerifier,
  type ReconcilePermitOptions,
  type SurfacePosture,
  type SyntheticPermitCandidate,
} from './reconcile.js';
export type { PermitActor } from '@ontrails/core';
export { derivePermitIdentityKey } from './identity.js';
export {
  validatePermits,
  type PermitDiagnostic,
  type PermitDiagnosticSeverity,
} from './rules.js';
