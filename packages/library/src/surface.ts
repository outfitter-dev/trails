/**
 * The in-memory library surface: `surface(graph, options)` returns a callable
 * client. It is a peer of the CLI, MCP, and HTTP surfaces — same contract, same
 * shared pipeline — and the first surface whose `surface()` returns a held
 * client rather than opening a long-running endpoint.
 *
 * The client routes execution through the runtime kernel (`kernelRun`), never
 * through ad hoc `@ontrails/core` deep imports, so the standalone trajectory
 * stays a vendoring step. Root-call behavior: unwrap `Result.ok` to a return
 * value, throw on `Result.err`. The held client also exposes a no-throw
 * `result` lane with the same export names so downstream package emission can
 * later map that lane to the generated `/result` subpath. Package-facing
 * error-class mapping stays in the error lane — TRL-966.
 */
import { deriveLibraryApi } from './derive.js';
import type { DeriveLibraryApiOptions, LibraryProjection } from './derive.js';
import { kernelRun } from './kernel.js';
import type { KernelRunOptions, Result, Topo } from './kernel.js';

/**
 * Options for the in-memory library surface: projection selectors plus the
 * runtime context the client owns (e.g. a permit for permitted trails).
 */
export interface SurfaceLibraryOptions
  extends DeriveLibraryApiOptions, KernelRunOptions {}

/** A callable library method: validated input in, output out, throws on failure. */
export type LibraryMethod = (input: unknown) => Promise<unknown>;

/** A no-throw library method: validated input in, raw Result boundary out. */
export type LibraryResultMethod = (
  input: unknown
) => Promise<Result<unknown, Error>>;

/** The held in-memory client: one method per projected export, plus the projection. */
export interface LibraryClient {
  /** Invoke an exported trail by its consumer-native name. */
  readonly call: Readonly<Record<string, LibraryMethod>>;
  /** Invoke an exported trail by name without unwrapping the Result boundary. */
  readonly result: Readonly<Record<string, LibraryResultMethod>>;
  /** The resolved projection this client was built from (introspection). */
  readonly projection: LibraryProjection;
}

/**
 * Materialize a topo as an in-memory library client. Each projected export
 * becomes a method that executes its trail through the shared pipeline and
 * unwraps the Result — returning the value or throwing the error. The same
 * export names are available under `result` for callers that want the raw
 * `Result` boundary.
 *
 * @example
 * const lib = await surface(app);
 * const widget = await lib.call.widgetGet({ id: '1' });
 */
export const surface = async (
  graph: Topo,
  options: SurfaceLibraryOptions = {}
  // oxlint-disable-next-line require-await -- async to match peer surfaces and allow future resource init
): Promise<LibraryClient> => {
  const projection = deriveLibraryApi(graph, options);
  const runOptions: KernelRunOptions = {
    abortSignal: options.abortSignal,
    ctx: options.ctx,
  };
  const call: Record<string, LibraryMethod> = {};
  const result: Record<string, LibraryResultMethod> = {};

  for (const entry of projection.exports) {
    const runExport: LibraryResultMethod = (input: unknown) =>
      kernelRun(graph, entry.trailId, input, runOptions);
    result[entry.exportName] = runExport;

    call[entry.exportName] = async (input: unknown): Promise<unknown> => {
      const outcome = await runExport(input);
      if (outcome.isErr()) {
        throw outcome.error;
      }
      return outcome.value;
    };
  }

  return {
    call: Object.freeze(call),
    projection,
    result: Object.freeze(result),
  };
};
