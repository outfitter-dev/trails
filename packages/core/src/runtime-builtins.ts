/**
 * Lazy runtime-builtin loading for the execution-portable core barrel.
 *
 * Core tooling modules that need Bun or Node capabilities (`bun:sqlite`,
 * `node:fs`, `node:os`, `node:path`) must not import them eagerly: the
 * core barrel sits on the execution path of every surface, and edge
 * runtimes such as workerd refuse module graphs that import `bun:`
 * builtins and gate `node:` builtins behind compatibility flags
 * (TRL-1198). Loading through `process.getBuiltinModule` keeps the
 * specifier out of bundler module graphs entirely and defers the
 * capability requirement to first use, so runtimes that never call a
 * tooling helper never pay for it.
 */

import type * as BunSqlite from 'bun:sqlite';
import type * as NodeFs from 'node:fs';
import type * as NodeOs from 'node:os';
import type * as NodePath from 'node:path';

import { InternalError } from './errors.js';

interface BuiltinModules {
  readonly 'bun:sqlite': typeof BunSqlite;
  readonly 'node:fs': typeof NodeFs;
  readonly 'node:os': typeof NodeOs;
  readonly 'node:path': typeof NodePath;
}

const loadedBuiltins = new Map<keyof BuiltinModules, unknown>();

/**
 * Load a Bun/Node builtin module at first use.
 *
 * @throws {InternalError} When the runtime does not expose the builtin
 * (for example workerd without `nodejs_compat`). Trail execution never
 * reaches this loader; only tooling helpers (trails-db, workspace
 * discovery) do.
 */
export const loadRuntimeBuiltin = <TName extends keyof BuiltinModules>(
  name: TName
): BuiltinModules[TName] => {
  const cached = loadedBuiltins.get(name);
  if (cached !== undefined) {
    return cached as BuiltinModules[TName];
  }

  const proc = (
    globalThis as {
      readonly process?: {
        readonly getBuiltinModule?: (id: string) => unknown;
      };
    }
  ).process;
  if (typeof proc?.getBuiltinModule !== 'function') {
    throw new InternalError(
      `Runtime builtin "${name}" is unavailable: this runtime does not expose process.getBuiltinModule. Trails tooling helpers need a Bun or Node runtime; the trail execution path never loads them.`
    );
  }

  const loaded = proc.getBuiltinModule(name);
  if (loaded === undefined || loaded === null) {
    throw new InternalError(
      `Runtime builtin "${name}" is unavailable on this runtime.`
    );
  }

  loadedBuiltins.set(name, loaded);
  return loaded as BuiltinModules[TName];
};
