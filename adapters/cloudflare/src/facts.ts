/**
 * Cloudflare lock facts.
 *
 * The adapter's `trails.lock` overlay: `derive` derives the topo's env-bound
 * resources (resources with a registered {@link EnvBindingSpec | env
 * binding}, such as every `cloudflareKv` definition) into
 * `overlays.cloudflare`, listing the wrangler binding name each resource
 * resolves from, plus one fact per core `schedule()` source: the normalized
 * cron and the UTC-only realization Cron Triggers impose. The import from
 * `@ontrails/adapter-kit` is type-only — the adapter never depends on the
 * adapter kit at runtime.
 */

import type { Overlay } from '@ontrails/adapter-kit';
import type { AnyResource, Topo } from '@ontrails/core';
import { z } from 'zod';

import { getEnvBinding } from './env.js';
import type { EnvBindingSpec } from './env.js';

/**
 * How Cloudflare realizes a cron: Cron Triggers evaluate in UTC only, so a
 * schedule that declares another timezone cannot run as declared.
 */
export const CLOUDFLARE_CRON_REALIZATION = 'utc-only';

const scheduleFactSchema = z
  .object({
    /** Normalized cron expression (trimmed, single-spaced fields). */
    cron: z.string(),
    /** Provider realization constraint; always `utc-only` on Cloudflare. */
    realization: z.literal(CLOUDFLARE_CRON_REALIZATION),
    sourceId: z.string(),
    /** The timezone the schedule declared, when it declared one. */
    timezone: z.string().optional(),
    trailId: z.string(),
  })
  .strict();

const cloudflareFactsSchema = z
  .object({
    bindings: z.array(
      z
        .object({
          binding: z.string(),
          resourceId: z.string(),
        })
        .strict()
    ),
    schedules: z.array(scheduleFactSchema),
  })
  .strict();

/**
 * The facts embedded at `overlays.cloudflare` in `trails.lock`: one entry
 * per env-bound resource, pairing the resource ID with its wrangler binding
 * name, and one entry per `schedule()` source with its normalized cron and
 * the UTC-only realization.
 */
export type CloudflareLockFacts = z.infer<typeof cloudflareFactsSchema>;

/** One `schedule()` source as the lock records it. */
export type CloudflareScheduleFact = z.infer<typeof scheduleFactSchema>;

/**
 * Every resource visible on the topo: module-registered resources plus
 * resources declared on trail contracts (including fork version entries),
 * which core executes with but `topo()` does not auto-register.
 */
const collectTopoResources = (graph: Topo): readonly AnyResource[] => {
  const collected = new Map<string, AnyResource>();
  for (const definition of graph.listResources()) {
    collected.set(definition.id, definition);
  }
  for (const graphTrail of graph.list()) {
    const declared = [
      ...graphTrail.resources,
      ...Object.values(graphTrail.versions ?? {}).flatMap(
        (entry) => entry.resources ?? []
      ),
    ];
    for (const definition of declared) {
      if (!collected.has(definition.id)) {
        collected.set(definition.id, definition);
      }
    }
  }
  return [...collected.values()];
};

/** Match core's schedule normalization: trimmed, single-spaced fields. */
const normalizeCron = (cron: string): string =>
  cron.trim().replaceAll(/\s+/g, ' ');

const deriveBindings = (graph: Topo): CloudflareLockFacts['bindings'] =>
  collectTopoResources(graph)
    .map((definition) => ({
      definition,
      spec: getEnvBinding(definition),
    }))
    .filter(
      (entry): entry is { definition: AnyResource; spec: EnvBindingSpec } =>
        entry.spec !== undefined
    )
    .map((entry) => ({
      binding: entry.spec.binding,
      resourceId: entry.definition.id,
    }))
    .toSorted(
      (a, b) =>
        a.resourceId.localeCompare(b.resourceId) ||
        a.binding.localeCompare(b.binding)
    );

const deriveSchedules = (graph: Topo): CloudflareLockFacts['schedules'] => {
  const facts: CloudflareScheduleFact[] = [];
  for (const graphTrail of graph.list()) {
    for (const activation of graphTrail.activationSources) {
      const { source } = activation;
      if (source.kind !== 'schedule' || typeof source.cron !== 'string') {
        continue;
      }
      facts.push({
        cron: normalizeCron(source.cron),
        realization: CLOUDFLARE_CRON_REALIZATION,
        sourceId: source.id,
        ...(source.timezone === undefined ? {} : { timezone: source.timezone }),
        trailId: graphTrail.id,
      });
    }
  }
  return facts.toSorted(
    (a, b) =>
      a.trailId.localeCompare(b.trailId) ||
      a.sourceId.localeCompare(b.sourceId) ||
      a.cron.localeCompare(b.cron)
  );
};

const derive = (graph: Topo): CloudflareLockFacts => ({
  bindings: deriveBindings(graph),
  schedules: deriveSchedules(graph),
});

/**
 * The Cloudflare adapter's `trails.lock` overlay.
 *
 * An app opts in by exporting `trailsOverlays` next to its topo export;
 * `trails compile` then validates `derive(topo)` against the facts schema
 * and embeds the result as `overlays.cloudflare`, listing every env-bound
 * resource's wrangler binding and every `schedule()` source's normalized
 * cron with its UTC-only realization. Derivation is deterministic: the same
 * topo always yields the same facts, sorted by resource ID then binding, and
 * by trail ID, source ID then cron.
 *
 * @example
 * ```ts
 * import { cloudflareOverlay, cloudflareKv } from '@ontrails/cloudflare';
 * import { topo } from '@ontrails/core';
 *
 * export const flags = cloudflareKv('flags', { binding: 'FLAGS' });
 * export const app = topo('my-worker', { flags });
 * export const trailsOverlays = [cloudflareOverlay];
 * // `trails compile` embeds overlays.cloudflare:
 * // { bindings: [{ binding: 'FLAGS', resourceId: 'flags' }], schedules: [] }
 * ```
 */
export const cloudflareOverlay = {
  derive,
  namespace: 'cloudflare',
  schema: cloudflareFactsSchema,
} satisfies Overlay;
