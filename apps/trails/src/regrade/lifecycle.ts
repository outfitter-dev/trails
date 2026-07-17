import type { ProgressCallback, Result } from '@ontrails/core';
import { z } from 'zod';

export const regradeLifecyclePhaseSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  name: z.string().min(1),
  status: z.literal('completed'),
});

export const regradeLifecycleSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  phases: z.array(regradeLifecyclePhaseSchema),
});

export type RegradeLifecycle = z.output<typeof regradeLifecycleSchema>;

interface RegradeLifecycleTrackerOptions {
  readonly now?: (() => number) | undefined;
  readonly progress?: ProgressCallback | undefined;
}

const elapsedMilliseconds = (startedAt: number, finishedAt: number): number =>
  Math.max(0, Math.round(finishedAt - startedAt));

const phaseLabel = (name: string): string => name.replaceAll('-', ' ');

export class RegradeLifecycleTracker {
  readonly #now: () => number;
  readonly #phases: RegradeLifecycle['phases'][number][] = [];
  readonly #progress: ProgressCallback | undefined;
  readonly #startedAt: number;

  constructor(options: RegradeLifecycleTrackerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#progress = options.progress;
    this.#startedAt = this.#now();
  }

  async run<T, E extends Error>(
    name: string,
    operation: () => Promise<Result<T, E>> | Result<T, E>
  ): Promise<Result<T, E>> {
    const startedAt = this.#now();
    this.#progress?.({
      message: `Regrade: ${phaseLabel(name)}`,
      ts: new Date().toISOString(),
      type: 'start',
    });

    const result = await operation();
    const durationMs = elapsedMilliseconds(startedAt, this.#now());
    if (result.isErr()) {
      this.#progress?.({
        message: `Regrade: ${phaseLabel(name)} failed (${durationMs} ms)`,
        ts: new Date().toISOString(),
        type: 'error',
      });
      return result;
    }

    this.#phases.push({ durationMs, name, status: 'completed' });
    this.#progress?.({
      message: `Regrade: ${phaseLabel(name)} complete (${durationMs} ms)`,
      ts: new Date().toISOString(),
      type: 'complete',
    });
    return result;
  }

  summary(): RegradeLifecycle {
    return {
      durationMs: elapsedMilliseconds(this.#startedAt, this.#now()),
      phases: [...this.#phases],
    };
  }
}
