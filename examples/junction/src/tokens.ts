/**
 * HS256 JWT minting for junction's two roles.
 *
 * `admin` tokens carry `relay:read relay:write`; `viewer` tokens carry
 * `relay:read` only. The permits JWT adapter reads scopes from the standard
 * space-separated `scope` claim. Minting lives in the app because it is a
 * dev/ops convenience — verification is the framework's job.
 */

import { createHmac } from 'node:crypto';

export const roles = ['admin', 'viewer'] as const;
export type Role = (typeof roles)[number];

const scopesByRole = {
  admin: 'relay:read relay:write',
  viewer: 'relay:read',
} as const satisfies Record<Role, string>;

const base64url = (value: string | Buffer): string =>
  Buffer.from(value).toString('base64url');

export const mintToken = (options: {
  readonly expiresInSeconds?: number;
  readonly role: Role;
  readonly secret: string;
  readonly subject?: string;
}): string => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      exp: now + (options.expiresInSeconds ?? 3600),
      iat: now,
      scope: scopesByRole[options.role],
      sub: options.subject ?? `junction-${options.role}`,
    })
  );
  const signature = createHmac('sha256', options.secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
};
