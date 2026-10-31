import { z } from 'zod';

export const permitExtractionInputSchema = z
  .object({
    /** Candidate from x-api-key, without an implied trust decision. */
    apiKey: z.string().optional(),
    /** Candidate from x-auth-token, without an implied trust decision. */
    authToken: z.string().optional(),
    /** Original Authorization value; the adapter owns its accepted scheme. */
    authorization: z.string().optional(),
    /** Bearer token from Authorization header or equivalent. */
    bearerToken: z.string().optional(),
    /** Raw headers (HTTP surface only, typically). */
    headers: z.instanceof(Headers).optional(),
    /** Correlation ID for tracing. */
    requestId: z.string(),
    /** Session identifier from transport handshake. */
    sessionId: z.string().optional(),
    /** Which surface produced this extraction. */
    surface: z.enum(['http', 'mcp', 'cli']),
  })
  .readonly();

/**
 * Normalized input for auth adapters.
 *
 * Each surface extracts raw credentials from its transport and normalizes them
 * into this shape. No surface types (Request, McpSession, etc.) cross into
 * core -- only this schema-derived contract.
 */
export type PermitExtractionInput = z.infer<typeof permitExtractionInputSchema>;
