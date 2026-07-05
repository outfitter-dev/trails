/**
 * stash — self-hosted gists on Trails.
 *
 * The topo is the public entry: compile it, surface it, or embed it.
 */

/**
 * The stash topo: snippets, immutable revisions, forks, stars, tokens, and
 * the signal-driven search index.
 *
 * @example
 * ```typescript
 * import { run } from '@ontrails/core';
 * import { graph } from 'stash';
 *
 * const result = await run(graph, 'snippet.get', { id: 'snip_hello' });
 * ```
 */
export { graph } from './app.js';
