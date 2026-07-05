/**
 * Schema-derived relay store for junction.
 *
 * Five tables carry the relay pipeline: inbound `endpoint` configuration,
 * received `event` records, outbound `target` configuration, `route`
 * bindings between the two, and `delivery` attempts. Authored once here,
 * projected to SQLite through `@ontrails/drizzle`.
 */

import { store as defineStore } from '@ontrails/store';
import { z } from 'zod';

import { endpointSourceSchema } from './verify.js';

export const endpointSchema = z.object({
  createdAt: z.string().describe('ISO-8601 creation timestamp'),
  enabled: z.boolean().describe('Whether the endpoint accepts webhooks'),
  id: z.string().describe('Endpoint identifier'),
  name: z.string().describe('Human-readable endpoint name'),
  secret: z.string().describe('HMAC secret senders sign payloads with'),
  source: endpointSourceSchema,
});

export const eventStatusSchema = z
  .enum(['received', 'relayed', 'dead'])
  .describe('Relay lifecycle status of the event');

export const eventSchema = z.object({
  endpointId: z.string().describe('Endpoint that received the event'),
  headers: z
    .looseObject({})
    .describe('Allowlisted subset of the inbound request headers'),
  id: z.string().describe('Event identifier'),
  payload: z.looseObject({}).describe('JSON payload the sender delivered'),
  receivedAt: z.string().describe('ISO-8601 receipt timestamp'),
  signatureValid: z
    .boolean()
    .describe('Whether the inbound signature verified against the secret'),
  status: eventStatusSchema,
});

export const targetSchema = z.object({
  enabled: z.boolean().describe('Whether the target receives deliveries'),
  id: z.string().describe('Target identifier'),
  name: z.string().describe('Human-readable target name'),
  url: z.string().describe('URL deliveries are POSTed to'),
});

export const routeSchema = z.object({
  enabled: z.boolean().describe('Whether the route relays events'),
  endpointId: z.string().describe('Endpoint the route listens on'),
  filterEquals: z
    .string()
    .nullable()
    .default(null)
    .describe('Value the payload path must equal for the route to match'),
  filterPath: z
    .string()
    .nullable()
    .default(null)
    .describe('Dot-separated payload path the filter reads'),
  id: z.string().describe('Route identifier'),
  targetId: z.string().describe('Target the route delivers to'),
});

export const deliveryStatusSchema = z
  .enum(['pending', 'delivered', 'failed'])
  .describe('Outcome of the delivery');

export const deliverySchema = z.object({
  attempts: z.number().int().describe('POST attempts made so far'),
  eventId: z
    .string()
    .nullable()
    .default(null)
    .describe('Event the delivery carries; null for target test pings'),
  id: z.string().describe('Delivery identifier'),
  lastError: z
    .string()
    .nullable()
    .default(null)
    .describe('Most recent delivery error, when any attempt failed'),
  status: deliveryStatusSchema,
  targetId: z.string().describe('Target the delivery POSTs to'),
});

export type Endpoint = z.output<typeof endpointSchema>;
export type Route = z.output<typeof routeSchema>;
export type Delivery = z.output<typeof deliverySchema>;

export const relayStoreDefinition = defineStore({
  delivery: {
    generated: ['id'],
    indexes: ['eventId', 'status'],
    primaryKey: 'id',
    schema: deliverySchema,
  },
  endpoint: {
    generated: ['id', 'createdAt'],
    indexes: ['source'],
    primaryKey: 'id',
    schema: endpointSchema,
  },
  event: {
    generated: ['id'],
    indexes: ['endpointId', 'status'],
    primaryKey: 'id',
    schema: eventSchema,
  },
  route: {
    generated: ['id'],
    indexes: ['endpointId'],
    primaryKey: 'id',
    schema: routeSchema,
  },
  target: {
    generated: ['id'],
    indexes: ['name'],
    primaryKey: 'id',
    schema: targetSchema,
  },
});
