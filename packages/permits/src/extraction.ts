/**
 * Normalized input for auth connectors.
 *
 * Each trailhead extracts raw credentials from its transport and normalizes
 * them into this shape. No trailhead types (Request, McpSession, etc.) cross
 * into core — only this interface.
 */
export interface PermitExtractionInput {
  /** Which trailhead produced this extraction */
  readonly trailhead: 'http' | 'mcp' | 'cli';
  /** Bearer token from Authorization header or equivalent */
  readonly bearerToken?: string;
  /** Session identifier from transport handshake */
  readonly sessionId?: string;
  /** Raw headers (HTTP trailhead only, typically) */
  readonly headers?: Headers;
  /** Correlation ID for tracing */
  readonly requestId: string;
}
