/**
 * Default redaction patterns and sensitive key lists.
 *
 * These are used by {@link createRedactor} to strip secrets from strings
 * and object values before they reach logs, traces, or error payloads.
 */

// ---------------------------------------------------------------------------
// Regex patterns that match sensitive values inside arbitrary strings
// ---------------------------------------------------------------------------

export const DEFAULT_PATTERNS: RegExp[] = [
  // Credit card numbers: 4 groups of 4 digits separated by spaces or dashes
  /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g,

  // SSN: XXX-XX-XXXX
  /\b\d{3}-\d{2}-\d{4}\b/g,

  // Bearer tokens
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,

  // Basic auth
  /Basic\s+[A-Za-z0-9+/]+=*/g,

  // API keys: sk-*, pk_*, sk_* prefixed tokens
  /\b(?:sk-|pk_|sk_)[A-Za-z0-9_-]{8,}\b/g,

  // JWT tokens: eyJ... (three base64url segments separated by dots)
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];

// ---------------------------------------------------------------------------
// Object keys whose values should always be redacted
// ---------------------------------------------------------------------------

export const DEFAULT_SENSITIVE_KEYS: string[] = [
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'ssn',
  'creditCard',
  'credit_card',
];
