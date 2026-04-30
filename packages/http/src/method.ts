import type { Intent } from '@ontrails/core';

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export type HttpOperationMethod = Lowercase<HttpMethod>;

export type InputSource = 'query' | 'body';

export const httpMethodByIntent = {
  destroy: 'DELETE',
  read: 'GET',
  write: 'POST',
} as const satisfies Record<Intent, HttpMethod>;

export const deriveHttpMethod = (intent: Intent): HttpMethod =>
  (httpMethodByIntent as Partial<Record<string, HttpMethod>>)[intent] ?? 'POST';

export const deriveHttpOperationMethod = (
  intent: Intent
): HttpOperationMethod =>
  deriveHttpMethod(intent).toLowerCase() as HttpOperationMethod;

export const deriveHttpInputSource = (method: HttpMethod): InputSource =>
  method === 'GET' ? 'query' : 'body';
