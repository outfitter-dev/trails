import { isPlainObject } from '@ontrails/core';

type PublicAlgorithm = 'RS256' | 'ES256' | 'EdDSA';
type PublicJwk = JsonWebKey & { readonly kid?: string };

interface KeySet {
  readonly keys: readonly PublicJwk[];
  readonly expiresAt: number;
}

interface KeySource {
  endpoint?: string;
  metadataExpiresAt?: number;
  failedAt?: number;
  snapshot?: KeySet;
  pending?: Promise<KeySet> | undefined;
  refreshedAt: number;
  readonly imported: WeakMap<
    PublicJwk,
    Map<PublicAlgorithm, Promise<CryptoKey>>
  >;
}

const CACHE_MILLISECONDS = 300_000;
const REFRESH_COOLDOWN_MILLISECONDS = 30_000;
const MAX_SOURCES = 32;

// The surface boundary may recreate authResource on each POST. Share only
// public verification material keyed by trusted configuration, never tokens.
const sources = new Map<string, KeySource>();

const secureUrl = (value: string, issuer = false): URL => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (issuer && url.search) ||
    url.hash
  ) {
    throw new Error(
      'JWT endpoints require HTTPS without credentials or fragments; issuers cannot contain a query'
    );
  }
  return url;
};

const fetchJson = async (url: string): Promise<Response> =>
  await fetch(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });

/** Discover only from configured issuer URLs, never token jku/x5u headers. */
const discover = async (issuer: string): Promise<string> => {
  const url = secureUrl(issuer, true);
  const path = url.pathname.replace(/\/$/, '');
  const oidc = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  let response = await fetchJson(oidc);
  // RFC 8414 inserts its well-known component before an issuer's path.
  if (response.status === 404) {
    response = await fetchJson(
      `${url.origin}/.well-known/oauth-authorization-server${path}`
    );
  }
  if (!response.ok) {
    throw new Error('Unable to retrieve JWT issuer metadata');
  }
  const metadata: unknown = await response.json();
  if (
    !isPlainObject(metadata) ||
    metadata['issuer'] !== issuer ||
    typeof metadata['jwks_uri'] !== 'string'
  ) {
    throw new Error('Invalid JWT issuer metadata');
  }
  return secureUrl(metadata['jwks_uri']).href;
};

const keySource = (issuer: string, jwksUrl: string | undefined): KeySource => {
  const id = JSON.stringify([issuer, jwksUrl]);
  const existing = sources.get(id);
  if (existing) {
    sources.delete(id);
    sources.set(id, existing);
    return existing;
  }
  if (sources.size >= MAX_SOURCES) {
    const oldest = sources.keys().next().value;
    if (oldest !== undefined) {
      sources.delete(oldest);
    }
  }
  const source: KeySource = { imported: new WeakMap(), refreshedAt: -Infinity };
  sources.set(id, source);
  return source;
};

const readKeys = async (
  source: KeySource,
  issuer: string,
  jwksUrl: string | undefined
): Promise<KeySet> => {
  if (!source.endpoint || (source.metadataExpiresAt ?? 0) <= Date.now()) {
    source.endpoint =
      jwksUrl === undefined ? await discover(issuer) : secureUrl(jwksUrl).href;
    source.metadataExpiresAt = Date.now() + CACHE_MILLISECONDS;
  }
  const response = await fetchJson(source.endpoint);
  if (!response.ok) {
    throw new Error('Unable to retrieve JWT verification keys');
  }
  const body: unknown = await response.json();
  if (
    !isPlainObject(body) ||
    !Array.isArray(body['keys']) ||
    !body['keys'].every(isPlainObject)
  ) {
    throw new Error('Invalid JWT verification keys');
  }
  const snapshot = {
    expiresAt: Date.now() + CACHE_MILLISECONDS,
    keys: body['keys'] as PublicJwk[],
  };
  source.snapshot = snapshot;
  return snapshot;
};

const loadKeys = async (
  source: KeySource,
  issuer: string,
  jwksUrl: string | undefined
): Promise<KeySet> => {
  try {
    return await readKeys(source, issuer, jwksUrl);
  } catch (error) {
    source.failedAt = Date.now();
    throw error;
  } finally {
    source.pending = undefined;
  }
};

const refresh = (
  source: KeySource,
  issuer: string,
  jwksUrl: string | undefined
): Promise<KeySet> => {
  if (
    source.failedAt !== undefined &&
    Date.now() - source.failedAt < REFRESH_COOLDOWN_MILLISECONDS
  ) {
    return Promise.reject(new Error('JWT key refresh temporarily unavailable'));
  }
  source.pending ??= loadKeys(source, issuer, jwksUrl);
  return source.pending;
};

const compatibleKey = (key: PublicJwk, algorithm: PublicAlgorithm): boolean => {
  const expected = {
    ES256: key.kty === 'EC' && key.crv === 'P-256',
    EdDSA: key.kty === 'OKP' && key.crv === 'Ed25519',
    RS256: key.kty === 'RSA',
  };
  return (
    expected[algorithm] &&
    (key.alg === undefined || key.alg === algorithm) &&
    (key.use === undefined || key.use === 'sig') &&
    (key.key_ops === undefined || key.key_ops.includes('verify')) &&
    key.d === undefined
  );
};

const selectKey = (
  snapshot: KeySet,
  algorithm: PublicAlgorithm,
  kid: string | undefined
): PublicJwk | undefined => {
  const matches = snapshot.keys.filter(
    (key) =>
      compatibleKey(key, algorithm) && (kid === undefined || key.kid === kid)
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const importAlgorithm = (algorithm: PublicAlgorithm) =>
  ({
    ES256: { name: 'ECDSA', namedCurve: 'P-256' },
    EdDSA: { name: 'Ed25519' },
    RS256: { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
  })[algorithm];

const importKey = (
  source: KeySource,
  key: PublicJwk,
  algorithm: PublicAlgorithm
): Promise<CryptoKey> => {
  let imported = source.imported.get(key);
  if (!imported) {
    imported = new Map();
    source.imported.set(key, imported);
  }
  let promise = imported.get(algorithm);
  if (!promise) {
    promise = crypto.subtle.importKey(
      'jwk',
      key,
      importAlgorithm(algorithm),
      false,
      ['verify']
    );
    imported.set(algorithm, promise);
  }
  return promise;
};

/** Internal issuer-key verification; failures are normalized by the adapter. */
export const verifyIssuerSignature = async (
  issuer: string,
  jwksUrl: string | undefined,
  algorithm: PublicAlgorithm,
  kid: string | undefined,
  data: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>
): Promise<boolean> => {
  secureUrl(issuer, true);
  const source = keySource(issuer, jwksUrl);
  const snapshot =
    source.snapshot && source.snapshot.expiresAt > Date.now()
      ? source.snapshot
      : await refresh(source, issuer, jwksUrl);
  let key = selectKey(snapshot, algorithm, kid);
  if (!key && source.pending) {
    key = selectKey(await source.pending, algorithm, kid);
  }
  if (
    !key &&
    kid !== undefined &&
    Date.now() - source.refreshedAt >= REFRESH_COOLDOWN_MILLISECONDS
  ) {
    source.refreshedAt = Date.now();
    key = selectKey(await refresh(source, issuer, jwksUrl), algorithm, kid);
  }
  if (!key) {
    return false;
  }
  const cryptoKey = await importKey(source, key, algorithm);
  if (
    algorithm === 'RS256' &&
    (cryptoKey.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048
  ) {
    return false;
  }
  return await crypto.subtle.verify(
    algorithm === 'ES256'
      ? { hash: 'SHA-256', name: 'ECDSA' }
      : importAlgorithm(algorithm),
    cryptoKey,
    signature,
    data
  );
};
