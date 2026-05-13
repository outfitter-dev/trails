import type { Intent, WebhookMethod } from '@ontrails/core';

export type HttpMethod = 'GET' | 'POST' | 'DELETE' | WebhookMethod;

export type HttpOperationMethod = Lowercase<HttpMethod>;

export type InputSource = 'query' | 'body' | 'webhook';

export const httpMethodByIntent = {
  destroy: 'DELETE',
  read: 'GET',
  write: 'POST',
} as const satisfies Record<Intent, HttpMethod>;

/**
 * Derive the HTTP method used for a trail intent.
 *
 * @example
 * ```ts
 * import { deriveHttpMethod } from '@ontrails/http';
 *
 * const method = deriveHttpMethod('read');
 * // method === 'GET'
 * ```
 */
export const deriveHttpMethod = (intent: Intent): HttpMethod =>
  (httpMethodByIntent as Partial<Record<string, HttpMethod>>)[intent] ?? 'POST';

/**
 * Derive the lowercase OpenAPI operation method for a trail intent.
 *
 * @example
 * ```ts
 * import { deriveHttpOperationMethod } from '@ontrails/http';
 *
 * const operationMethod = deriveHttpOperationMethod('destroy');
 * // operationMethod === 'delete'
 * ```
 */
export const deriveHttpOperationMethod = (
  intent: Intent
): HttpOperationMethod =>
  deriveHttpMethod(intent).toLowerCase() as HttpOperationMethod;

/**
 * Derive where request input should be read from for an HTTP method.
 *
 * @example
 * ```ts
 * import { deriveHttpInputSource } from '@ontrails/http';
 *
 * const source = deriveHttpInputSource('GET');
 * // source === 'query'
 * ```
 */
export const deriveHttpInputSource = (method: HttpMethod): InputSource =>
  method === 'GET' ? 'query' : 'body';
