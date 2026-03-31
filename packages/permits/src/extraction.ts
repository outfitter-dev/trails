/**
 * Normalized input for auth adapters.
 *
 * Each surface extracts raw credentials from its transport and normalizes
 * them into this shape. No surface types (Request, McpSession, etc.) cross
 * into core — only this interface.
 */
export interface PermitExtractionInput {
  /** Which surface produced this extraction */
  readonly surface: 'http' | 'mcp' | 'cli';
  /** Bearer token from Authorization header or equivalent */
  readonly bearerToken?: string;
  /** Session identifier from transport handshake */
  readonly sessionId?: string;
  /** Raw headers (HTTP surface only, typically) */
  readonly headers?: Headers;
  /** Correlation ID for tracing */
  readonly requestId: string;
}
