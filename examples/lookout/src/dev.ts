/**
 * `lookout dev` — the watchable runtime loop.
 *
 * Materializes the `schedule.probe.sweep` activation source with an
 * interval-based cron factory, serves the public status page over HTTP, and
 * narrates each sweep. `--fast` drops the tick to two seconds and scales the
 * per-check intervals down (`LOOKOUT_INTERVAL_SCALE`), so probes, a detour
 * recovery, an incident opening, its notification, and the status page
 * update are all visible in one terminal minute.
 *
 * This module is surface-side orchestration, not trail logic — console
 * output is fine here.
 */

import { createScheduleRuntime, createTrailContext } from '@ontrails/core';
import type {
  ScheduleCronFactory,
  ScheduleRuntimeRunRecord,
} from '@ontrails/core';
import { surface as httpSurface } from '@ontrails/hono';

import { graph } from './app.js';
import { resolveHttpPermit } from './permits.js';

const OPERATOR_PERMIT = {
  id: 'dev-runtime',
  scopes: ['lookout:admin'],
};

const FAST_TICK_MS = 2000;
const NORMAL_TICK_MS = 60_000;

/**
 * Interval-based materializer for the sweep's `* * * * *` source. The
 * runtime's default factory needs `Bun.cron`; an interval is the honest
 * equivalent for a single every-minute source and lets fast mode tick at
 * seconds-scale.
 */
const intervalCron =
  (everyMs: number): ScheduleCronFactory =>
  (cron, handler) => {
    const timer = setInterval(() => {
      void handler();
    }, everyMs);
    return {
      cron,
      stop: () => clearInterval(timer),
      unref: () => timer.unref(),
    };
  };

interface SweepSummary {
  readonly probed: number;
  readonly results: readonly {
    readonly checkId: string;
    readonly ok: boolean;
    readonly outcome: string | null;
  }[];
}

const narrateRun = (record: ScheduleRuntimeRunRecord): void => {
  if (record.status === 'skipped') {
    return;
  }
  if (record.error || (record.result && record.result.isErr())) {
    console.log(`[lookout dev] sweep errored: ${record.error?.message ?? ''}`);
    return;
  }
  if (!record.result?.isOk()) {
    return;
  }
  const summary = record.result.value as SweepSummary;
  if (summary.probed === 0) {
    console.log('[lookout dev] sweep: nothing due');
    return;
  }
  for (const result of summary.results) {
    console.log(
      `[lookout dev] probed ${result.checkId} -> ${result.outcome ?? 'error'}`
    );
  }
};

export const runDev = async (options: { fast: boolean }): Promise<void> => {
  if (options.fast && process.env['LOOKOUT_INTERVAL_SCALE'] === undefined) {
    // 30s minimum intervals tick every 2s in fast mode.
    process.env['LOOKOUT_INTERVAL_SCALE'] = '15';
  }

  const port = Number(process.env['PORT'] ?? 4091);
  const http = await httpSurface(graph, {
    port,
    resolvePermit: resolveHttpPermit,
  });
  console.log(
    `[lookout dev] status page: ${http.url.replace(/\/$/, '')}/status/summary`
  );

  const runtime = createScheduleRuntime(graph, {
    createContext: () => createTrailContext({ permit: OPERATOR_PERMIT }),
    cron: intervalCron(options.fast ? FAST_TICK_MS : NORMAL_TICK_MS),
    onRun: narrateRun,
  });

  const started = await runtime.start();
  if (started.isErr()) {
    console.error(`[lookout dev] failed to start: ${started.error.message}`);
    await http.close();
    process.exitCode = 1;
    return;
  }
  console.log(
    `[lookout dev] schedule runtime running (${options.fast ? 'fast, 2s tick' : 'normal, 60s tick'}) — ctrl-c to stop`
  );

  const { promise: stopped, resolve } = Promise.withResolvers<boolean>();
  const shutdown = async (): Promise<void> => {
    console.log('[lookout dev] stopping');
    await runtime.stop();
    await http.close();
    resolve(true);
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  await stopped;
};
