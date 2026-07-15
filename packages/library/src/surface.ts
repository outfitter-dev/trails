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
 * map that lane to the generated `/result` subpath.
 */
import { Result, ValidationError } from '@ontrails/core';

import { deriveLibraryApi } from './derive.js';
import type {
  DeriveLibraryApiOptions,
  LibraryExport,
  LibraryRenderingPlan,
} from './derive.js';
import { toLibraryError } from './errors.js';
import type { LibraryError } from './errors.js';
import { partitionLibraryInput } from './layer-input.js';
import { kernelRun } from './kernel.js';
import type { KernelRunOptions, Topo } from './kernel.js';

/**
 * Options for the in-memory library surface: rendering selectors plus the
 * runtime context the client owns (e.g. a permit for permitted trails).
 */
export interface SurfaceLibraryOptions
  extends
    DeriveLibraryApiOptions,
    Omit<KernelRunOptions, 'layerInputs' | 'surfaceLayers' | 'topoLayers'> {}

/** A callable library method: validated input in, output out, throws on failure. */
export type LibraryMethod = (input: unknown) => Promise<unknown>;

/** A no-throw library method: validated input in, raw Result boundary out. */
export type LibraryResultMethod = (
  input: unknown
) => Promise<Result<unknown, LibraryError>>;

/** The held in-memory client: one method per rendered export, plus the rendering. */
export interface LibraryClient {
  /** Invoke an exported trail by its consumer-native name. */
  readonly call: Readonly<Record<string, LibraryMethod>>;
  /** Invoke an exported trail by name without unwrapping the Result boundary. */
  readonly result: Readonly<Record<string, LibraryResultMethod>>;
  /** The resolved rendering this client was built from (introspection). */
  readonly rendering: LibraryRenderingPlan;
}

const prepareLibraryInput = (
  entry: LibraryExport,
  input: unknown
):
  | {
      readonly layerInputs: Record<string, unknown>;
      readonly trailInput: unknown;
    }
  | ValidationError => {
  const parsed = entry.input.safeParse(input);
  if (!parsed.success) {
    return new ValidationError(
      `Invalid input for library export '${entry.exportName}': ${parsed.error.message}`,
      {
        cause: parsed.error,
        context: { issues: parsed.error.issues, trailId: entry.trailId },
      }
    );
  }
  return partitionLibraryInput(parsed.data, entry.layerInputs);
};

const runtimeOptionsFor = (
  graph: Topo,
  options: SurfaceLibraryOptions
): KernelRunOptions => ({
  abortSignal: options.abortSignal,
  configValues: options.configValues,
  createContext: options.createContext,
  ctx: options.ctx,
  dryRun: options.dryRun,
  permit: options.permit,
  resources: options.resources,
  surfaceLayers: options.layers,
  topoLayers: graph.layers,
  version: options.version,
});

export const runLibraryResult = async (
  graph: Topo,
  id: string,
  input: unknown,
  options: SurfaceLibraryOptions = {}
): Promise<Result<unknown, LibraryError>> => {
  const rendering = deriveLibraryApi(graph, options);
  const runOptions = runtimeOptionsFor(graph, options);
  const entry = rendering.exports.find((candidate) => candidate.trailId === id);
  const prepared = entry
    ? prepareLibraryInput(entry, input)
    : { layerInputs: {}, trailInput: input };
  if (prepared instanceof ValidationError) {
    return Result.err(toLibraryError(prepared));
  }
  const outcome = await kernelRun(graph, id, prepared.trailInput, {
    ...runOptions,
    ...(Object.keys(prepared.layerInputs).length === 0
      ? {}
      : { layerInputs: prepared.layerInputs }),
  });
  return outcome.mapErr(toLibraryError);
};

/**
 * Materialize a topo as an in-memory library client. Each rendered export
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
  const rendering = deriveLibraryApi(graph, options);
  const runOptions = runtimeOptionsFor(graph, options);
  const call: Record<string, LibraryMethod> = {};
  const result: Record<string, LibraryResultMethod> = {};

  for (const entry of rendering.exports) {
    const runExport: LibraryResultMethod = async (input: unknown) => {
      const prepared = prepareLibraryInput(entry, input);
      if (prepared instanceof ValidationError) {
        return Result.err(toLibraryError(prepared));
      }
      const outcome = await kernelRun(
        graph,
        entry.trailId,
        prepared.trailInput,
        {
          ...runOptions,
          ...(Object.keys(prepared.layerInputs).length === 0
            ? {}
            : { layerInputs: prepared.layerInputs }),
        }
      );
      return outcome.mapErr(toLibraryError);
    };
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
    rendering,
    result: Object.freeze(result),
  };
};
