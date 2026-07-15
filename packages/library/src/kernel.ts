/**
 * The runtime kernel: the minimal, single-sourced surface through which the
 * library surface (and, later, emitted packages) reach Trails execution.
 *
 * **This is the only module in `@ontrails/library` that imports execution
 * primitives from `@ontrails/core`.** Everything else — the in-memory surface,
 * the emitter's generated runtime — routes through here.
 *
 * Why this exists: standalone output (a generated package with no `@ontrails/*`
 * runtime dependency) must be reachable as a *vendoring step*, not a rewrite.
 * Confining the framework-runtime dependency to this one seam means "go
 * standalone" reduces to "vendor this module's imports," with consumer code and
 * package derivation unchanged. See the runtime-kernel section of the Library
 * Surface and Compiler ADR.
 *
 * The kernel grows only as materialization demands: today it wraps execution;
 * error rendering and the context/compose shim join it as the surface and
 * emitter lanes land. Keep it minimal and dependency-light on purpose.
 */
import { run } from '@ontrails/core';
import type {
  Result,
  RunOptions,
  Topo,
  TrailContextInit,
} from '@ontrails/core';

export type { Result, Topo, TrailContextInit };

/** Runtime options the kernel forwards to execution (permit, abort, layers, etc.). */
export type KernelRunOptions = Pick<
  RunOptions,
  | 'abortSignal'
  | 'configValues'
  | 'createContext'
  | 'ctx'
  | 'dryRun'
  | 'layerInputs'
  | 'permit'
  | 'resources'
  | 'surfaceLayers'
  | 'topoLayers'
  | 'version'
>;

/**
 * Execute a trail by id through the shared Trails pipeline. Never throws —
 * resolves to `Result.ok` on success or `Result.err(TrailsError)` on failure,
 * exactly as `run()` does. The library surface unwraps this into return/throw
 * (root API) or returns it directly (`/result`).
 *
 * @example
 * const result = await kernelRun(topo, 'thing.check', { root: '.' });
 * if (result.isOk()) {
 *   // result.value is the trail output
 * }
 */
export const kernelRun = (
  topo: Topo,
  id: string,
  input: unknown,
  options: KernelRunOptions = {}
): Promise<Result<unknown, Error>> => run(topo, id, input, options);
