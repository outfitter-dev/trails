#!/usr/bin/env bun

/**
 * Sign and send a webhook the way a real sender would.
 *
 * Computes the HMAC signature over the exact raw body for the endpoint's
 * source type and POSTs it to a running junction server.
 *
 * Usage:
 *   bun bin/send-webhook.ts <endpointId> <source> <secret> [payload-json] [base-url]
 *
 * Example:
 *   bun bin/send-webhook.ts ep_abc123 github 'jsec_...' '{"zen":"keep it logically awesome"}'
 */

import {
  endpointSources,
  signPayload,
  signatureHeaderBySource,
} from '../src/verify.js';
import type { EndpointSource } from '../src/verify.js';

const [endpointId, source, secret, payloadArg, baseUrlArg] =
  process.argv.slice(2);

if (
  endpointId === undefined ||
  secret === undefined ||
  source === undefined ||
  !(endpointSources as readonly string[]).includes(source)
) {
  process.stderr.write(
    `Usage: bun bin/send-webhook.ts <endpointId> <${endpointSources.join('|')}> <secret> [payload-json] [base-url]\n`
  );
  process.exit(1);
}

const typedSource = source as EndpointSource;
const rawBody = payloadArg ?? '{"junction":"hello","n":1}';
const baseUrl = baseUrlArg ?? 'http://localhost:3000';
const signature = signPayload(typedSource, { rawBody, secret });

const response = await fetch(`${baseUrl}/hooks/${endpointId}`, {
  body: rawBody,
  headers: {
    'content-type': 'application/json',
    [signatureHeaderBySource[typedSource]]: signature,
  },
  method: 'POST',
});

process.stdout.write(`${response.status} ${await response.text()}\n`);
process.exit(response.ok ? 0 : 1);
