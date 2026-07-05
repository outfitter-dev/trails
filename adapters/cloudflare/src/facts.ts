/**
 * Cloudflare lock facts.
 *
 * The adapter's `trails.lock` overlay overlay: `derive` projects the
 * topo's env-bound resources (resources with a registered
 * {@link EnvBindingSpec | env binding}, such as every `cloudflareKv`
 * definition) into `overlays.cloudflare`, listing the wrangler binding name
 * each resource resolves from. The import from `@ontrails/adapter-kit` is
 * type-only — the adapter never depends on the adapter kit at runtime.
 */

import type { Overlay } from '@ontrails/adapter-kit';
import type { AnyResource, Topo } from '@ontrails/core';
import { z } from 'zod';

import { getEnvBinding } from './env.js';
import type { EnvBindingSpec } from './env.js';

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
  })
  .strict();

/**
 * The facts embedded at `overlays.cloudflare` in `trails.lock`: one entry
 * per env-bound resource, pairing the resource ID with its wrangler binding
 * name.
 */
export type CloudflareLockFacts = z.infer<typeof cloudflareFactsSchema>;

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

const derive = (graph: Topo): CloudflareLockFacts => {
  const bindings = collectTopoResources(graph)
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
  return { bindings };
};

/**
 * The Cloudflare adapter's `trails.lock` overlay overlay.
 *
 * An app opts in by exporting `trailsOverlays` next to its topo export;
 * `trails compile` then validates `derive(topo)` against the facts schema
 * and embeds the result as `overlays.cloudflare`, listing every env-bound
 * resource's wrangler binding. Derivation is deterministic: the same topo
 * always yields the same facts, sorted by resource ID then binding.
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
 * // { bindings: [{ binding: 'FLAGS', resourceId: 'flags' }] }
 * ```
 */
export const cloudflareOverlay = {
  derive,
  namespace: 'cloudflare',
  schema: cloudflareFactsSchema,
} satisfies Overlay;
