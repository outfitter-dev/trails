import { mock } from 'bun:test';

type Algorithm = 'RS256' | 'ES256' | 'EdDSA';

const algorithms = {
  ES256: { name: 'ECDSA', namedCurve: 'P-256' },
  EdDSA: { name: 'Ed25519' },
  RS256: {
    hash: 'SHA-256',
    modulusLength: 2048,
    name: 'RSASSA-PKCS1-v1_5',
    publicExponent: new Uint8Array([1, 0, 1]),
  },
};

const encode = (value: string | ArrayBuffer): string =>
  Buffer.from(
    typeof value === 'string' ? value : new Uint8Array(value)
  ).toString('base64url');

export const jwksFixture = async (algorithm: Algorithm = 'RS256') => {
  const issuer = `https://issuer.example/${crypto.randomUUID()}`;
  const jwksUrl = `${issuer}/keys`;
  const audience = 'https://api.example';
  const requests: string[] = [];
  const makeKey = async (kid: string) => {
    const pair = (await crypto.subtle.generateKey(algorithms[algorithm], true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const jwk = {
      ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
      alg: algorithm,
      kid,
      use: 'sig',
    };
    const sign = async (
      claims: Record<string, unknown> = {},
      header: Record<string, unknown> = {}
    ) => {
      const input = `${encode(JSON.stringify({ alg: algorithm, kid, typ: 'JWT', ...header }))}.${encode(
        JSON.stringify({
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: issuer,
          scope: 'read write',
          sub: 'user-42',
          ...claims,
        })
      )}`;
      const signature = await crypto.subtle.sign(
        algorithm === 'ES256'
          ? { hash: 'SHA-256', name: 'ECDSA' }
          : algorithms[algorithm],
        pair.privateKey,
        new TextEncoder().encode(input)
      );
      return `${input}.${encode(signature)}`;
    };
    return { jwk, sign };
  };
  const key = await makeKey('first');
  const state = {
    keys: [key.jwk],
    keysStatus: 200,
    metadata: { issuer, jwks_uri: jwksUrl },
    metadataStatus: 200,
  };
  const fetcher = mock(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (url === jwksUrl) {
      return Response.json({ keys: state.keys }, { status: state.keysStatus });
    }
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json(state.metadata, { status: state.metadataStatus });
    }
    if (
      url ===
      `https://issuer.example/.well-known/oauth-authorization-server/${issuer.split('/').at(-1)}`
    ) {
      return Response.json(state.metadata);
    }
    throw new Error(`Unexpected test network request: ${url}`);
  });
  return { audience, fetcher, issuer, jwksUrl, key, makeKey, requests, state };
};
