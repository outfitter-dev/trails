/**
 * Heuristic detection of secret env var names.
 *
 * Matches common suffixes like `_SECRET`, `_TOKEN`, `_KEY`, `_PASSWORD`,
 * and `_CREDENTIALS` so that generated `.env.example` files and provenance
 * output can redact likely-secret values even without explicit `secret()`.
 */

const SECRET_PATTERN = /_SECRET$|_TOKEN$|_KEY$|_PASSWORD$|_CREDENTIALS$/i;

/** Return true when `envName` looks like it holds a secret value. */
export const isLikelySecret = (envName: string): boolean =>
  SECRET_PATTERN.test(envName);
