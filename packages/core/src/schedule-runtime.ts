import type { ActivationEntry } from './activation-source.js';
import { activationSourceKey } from './activation-source-projection.js';
import {
  buildActivationProvenanceTraceAttrs,
  withActivationProvenance,
} from './activation-provenance.js';
import type { ActivationProvenance } from './activation-provenance.js';
import { getActivationWherePredicate } from './activation-source.js';
import { createTrailContext } from './context.js';
import type { ExecuteTrailOptions } from './execute.js';
import { ConflictError, InternalError } from './errors.js';
import {
  getTraceSink,
  TRACE_CONTEXT_KEY,
  traceContextFromRecord,
  writeActivationTraceRecord,
} from './internal/tracing.js';
import type { TraceContext } from './internal/tracing.js';
import { Result } from './result.js';
import { drainResources } from './resource-config.js';
import type { ResourceDrainReport } from './resource-config.js';
import { run } from './run.js';
import type { Topo } from './topo.js';
import type { AnyTrail } from './trail.js';
import type { Logger, TrailContext, TrailContextInit } from './types.js';
import { validateTopo } from './validate-topo.js';

type ScheduleInputDefault = Record<string, never>;

export type ScheduleRuntimeState = 'idle' | 'running' | 'stopped' | 'stopping';

export type ScheduleCronHandler = () => Promise<void> | void;

export interface ScheduleCronJob {
  readonly cron?: string | undefined;
  ref?: (() => unknown) | undefined;
  stop(): unknown;
  unref?: (() => unknown) | undefined;
}

export type ScheduleCronFactory = (
  cron: string,
  handler: ScheduleCronHandler
) => ScheduleCronJob;

export type ScheduleRuntimeLogger = Pick<Logger, 'debug' | 'error' | 'warn'>;

export type ScheduleRuntimeSkipReason =
  | 'stopped'
  | 'where_error'
  | 'where_false';

export type ScheduleRuntimeRunStatus = 'err' | 'ok' | 'skipped';

export interface ScheduleRuntimeRunRecord {
  readonly activation?: ActivationProvenance | undefined;
  readonly error?: Error | undefined;
  readonly result?: Result<unknown, Error> | undefined;
  readonly skipReason?: ScheduleRuntimeSkipReason | undefined;
  readonly sourceId: string;
  readonly status: ScheduleRuntimeRunStatus;
  readonly trailId: string;
}

export interface ScheduleRuntimeOptions extends Pick<
  ExecuteTrailOptions,
  | 'abortSignal'
  | 'configValues'
  | 'createContext'
  | 'ctx'
  | 'layers'
  | 'resources'
> {
  readonly cron?: ScheduleCronFactory | undefined;
  readonly logger?: ScheduleRuntimeLogger | undefined;
  readonly onRun?:
    | ((record: ScheduleRuntimeRunRecord) => Promise<void> | void)
    | undefined;
  readonly unref?: boolean | undefined;
}

export interface ScheduleRuntimeRegistrationReport {
  readonly cron: string;
  readonly sourceId: string;
  readonly timezone?: string | undefined;
  readonly trailId: string;
}

export type ScheduleRuntimeWarningCode = 'schedule_timezone_metadata_only';

export interface ScheduleRuntimeWarning {
  readonly code: ScheduleRuntimeWarningCode;
  readonly message: string;
  readonly sourceId: string;
  readonly timezone: string;
  readonly trailId: string;
}

export interface ScheduleRuntimeStartReport {
  readonly registered: readonly ScheduleRuntimeRegistrationReport[];
  readonly warnings: readonly ScheduleRuntimeWarning[];
}

export interface ScheduleRuntimeStopReport {
  readonly resources: ResourceDrainReport;
  readonly settledRuns: number;
  readonly stopped: readonly ScheduleRuntimeRegistrationReport[];
}

export interface ScheduleRuntime {
  readonly state: () => ScheduleRuntimeState;
  readonly start: () => Promise<Result<ScheduleRuntimeStartReport, Error>>;
  readonly stop: () => Promise<Result<ScheduleRuntimeStopReport, Error>>;
}

interface BunCronGlobal {
  readonly Bun?: {
    readonly cron?: ScheduleCronFactory | undefined;
  };
}

interface ScheduleActivationRegistration {
  readonly activation: ActivationEntry;
  readonly cron: string;
  readonly input: unknown;
  readonly sourceId: string;
  readonly timezone?: string | undefined;
  readonly trail: AnyTrail;
}

interface RunningScheduleRegistration extends ScheduleActivationRegistration {
  readonly job: ScheduleCronJob;
}

const EMPTY_INPUT = Object.freeze({}) as ScheduleInputDefault;

const defaultCronFactory: ScheduleCronFactory = (cron, handler) => {
  const bunCron = (globalThis as unknown as BunCronGlobal).Bun?.cron;
  if (typeof bunCron !== 'function') {
    throw new InternalError(
      'Bun.cron is not available in this runtime; provide a cron factory to createScheduleRuntime()'
    );
  }
  return bunCron(cron, handler);
};

const errorFromUnknown = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const errorRecord = (error: Error): Record<string, unknown> => ({
  message: error.message,
  name: error.name,
  ...(error.cause instanceof Error
    ? { cause: { message: error.cause.message, name: error.cause.name } }
    : {}),
});

const registrationReport = (
  registration: ScheduleActivationRegistration
): ScheduleRuntimeRegistrationReport => ({
  cron: registration.cron,
  sourceId: registration.sourceId,
  ...(registration.timezone === undefined
    ? {}
    : { timezone: registration.timezone }),
  trailId: registration.trail.id,
});

const timezoneMetadataWarning = (
  registration: ScheduleActivationRegistration
): ScheduleRuntimeWarning | undefined =>
  registration.timezone === undefined || registration.timezone === 'UTC'
    ? undefined
    : {
        code: 'schedule_timezone_metadata_only',
        message:
          'The built-in Bun cron runtime records schedule timezone metadata but does not apply timezone-aware scheduling.',
        sourceId: registration.sourceId,
        timezone: registration.timezone,
        trailId: registration.trail.id,
      };

const collectStartWarnings = (
  registrations: readonly ScheduleActivationRegistration[]
): ScheduleRuntimeWarning[] =>
  registrations.flatMap((registration) => {
    const warning = timezoneMetadataWarning(registration);
    return warning === undefined ? [] : [warning];
  });

const logStartWarnings = (
  warnings: readonly ScheduleRuntimeWarning[],
  logger: ScheduleRuntimeLogger | undefined
): void => {
  for (const warning of warnings) {
    logger?.warn(warning.message, {
      code: warning.code,
      sourceId: warning.sourceId,
      timezone: warning.timezone,
      trailId: warning.trailId,
    });
  }
};

const sourceInput = (activation: ActivationEntry): unknown =>
  Object.hasOwn(activation.source, 'input')
    ? activation.source.input
    : EMPTY_INPUT;

const collectScheduleActivations = (
  graph: Topo
): ScheduleActivationRegistration[] => {
  const registrations = new Map<string, ScheduleActivationRegistration>();
  for (const trail of graph.list()) {
    for (const activation of trail.activationSources) {
      if (activation.source.kind !== 'schedule') {
        continue;
      }
      const key = `${trail.id}\0${activationSourceKey(activation.source)}`;
      const previous = registrations.get(key);
      if (
        previous !== undefined &&
        (previous.activation.where !== undefined ||
          activation.where === undefined)
      ) {
        continue;
      }
      registrations.set(key, {
        activation,
        cron:
          typeof activation.source.cron === 'string'
            ? activation.source.cron
            : '',
        input: sourceInput(activation),
        sourceId: activation.source.id,
        ...(activation.source.timezone === undefined
          ? {}
          : { timezone: activation.source.timezone }),
        trail,
      });
    }
  }

  return [...registrations.values()];
};

const scheduleActivationProvenance = (
  registration: ScheduleActivationRegistration
): ActivationProvenance => {
  const fireId = Bun.randomUUIDv7();
  return {
    fireId,
    rootFireId: fireId,
    source: {
      cron: registration.cron,
      id: registration.sourceId,
      kind: 'schedule',
      ...(registration.activation.source.meta === undefined
        ? {}
        : { meta: registration.activation.source.meta }),
      ...(registration.timezone === undefined
        ? {}
        : { timezone: registration.timezone }),
    },
  };
};

const scheduleActivationTraceAttrs = (
  registration: ScheduleActivationRegistration,
  activation: ActivationProvenance
): Readonly<Record<string, unknown>> => ({
  ...buildActivationProvenanceTraceAttrs(activation),
  'trails.activation.target_trail.id': registration.trail.id,
});

const recordScheduleActivationTrace = async (
  registration: ScheduleActivationRegistration,
  activation: ActivationProvenance,
  graph: Topo
): Promise<TraceContext | undefined> => {
  const record = await writeActivationTraceRecord(
    'activation.scheduled',
    scheduleActivationTraceAttrs(registration, activation),
    'ok',
    undefined,
    undefined,
    graph.observe?.trace ?? getTraceSink()
  );
  return record === undefined ? undefined : traceContextFromRecord(record);
};

const emitRunRecord = async (
  options: ScheduleRuntimeOptions,
  record: ScheduleRuntimeRunRecord
): Promise<void> => {
  try {
    await options.onRun?.(record);
  } catch (error) {
    options.logger?.warn('Schedule runtime onRun callback failed', {
      error: errorFromUnknown(error).message,
      sourceId: record.sourceId,
      trailId: record.trailId,
    });
  }
};

const runContextOption = (
  options: ScheduleRuntimeOptions,
  activation: ActivationProvenance | undefined,
  traceContext?: TraceContext | undefined
): Pick<ExecuteTrailOptions, 'ctx'> | Record<string, never> => {
  if (activation === undefined && traceContext === undefined) {
    return options.ctx === undefined ? {} : { ctx: options.ctx };
  }
  const withActivation =
    activation === undefined
      ? (options.ctx ?? {})
      : withActivationProvenance(options.ctx ?? {}, activation);
  const ctx =
    traceContext === undefined
      ? withActivation
      : {
          ...withActivation,
          extensions: {
            ...withActivation.extensions,
            [TRACE_CONTEXT_KEY]: traceContext,
          },
        };
  return { ctx };
};

const runOptions = (
  options: ScheduleRuntimeOptions,
  activation?: ActivationProvenance | undefined,
  traceContext?: TraceContext | undefined
): Pick<
  ExecuteTrailOptions,
  | 'abortSignal'
  | 'configValues'
  | 'createContext'
  | 'ctx'
  | 'layers'
  | 'resources'
> => ({
  ...(options.abortSignal === undefined
    ? {}
    : { abortSignal: options.abortSignal }),
  ...(options.configValues === undefined
    ? {}
    : { configValues: options.configValues }),
  ...(options.createContext === undefined
    ? {}
    : { createContext: options.createContext }),
  ...runContextOption(options, activation, traceContext),
  ...(options.layers === undefined ? {} : { layers: options.layers }),
  ...(options.resources === undefined ? {} : { resources: options.resources }),
});

const shouldRunActivation = async (
  registration: ScheduleActivationRegistration,
  options: ScheduleRuntimeOptions,
  activation: ActivationProvenance
): Promise<boolean> => {
  const predicate = getActivationWherePredicate(registration.activation.where);
  if (predicate === undefined) {
    return true;
  }

  try {
    const matched = await predicate(registration.input);
    if (!matched) {
      await emitRunRecord(options, {
        activation,
        skipReason: 'where_false',
        sourceId: registration.sourceId,
        status: 'skipped',
        trailId: registration.trail.id,
      });
    }
    return matched;
  } catch (error) {
    const cause = errorFromUnknown(error);
    options.logger?.warn('Schedule activation predicate failed', {
      error: cause.message,
      sourceId: registration.sourceId,
      trailId: registration.trail.id,
    });
    await emitRunRecord(options, {
      activation,
      error: cause,
      skipReason: 'where_error',
      sourceId: registration.sourceId,
      status: 'skipped',
      trailId: registration.trail.id,
    });
    return false;
  }
};

const executeScheduleActivation = async (
  graph: Topo,
  registration: ScheduleActivationRegistration,
  options: ScheduleRuntimeOptions,
  activation: ActivationProvenance
): Promise<void> => {
  const shouldRun = await shouldRunActivation(
    registration,
    options,
    activation
  );
  if (!shouldRun) {
    return;
  }

  const traceContext = await recordScheduleActivationTrace(
    registration,
    activation,
    graph
  );

  try {
    const result = await run(
      graph,
      registration.trail.id,
      registration.input,
      runOptions(options, activation, traceContext)
    );
    if (result.isErr()) {
      options.logger?.warn('Scheduled trail failed', {
        error: result.error.message,
        sourceId: registration.sourceId,
        trailId: registration.trail.id,
      });
      await emitRunRecord(options, {
        activation,
        result,
        sourceId: registration.sourceId,
        status: 'err',
        trailId: registration.trail.id,
      });
      return;
    }
    await emitRunRecord(options, {
      activation,
      result,
      sourceId: registration.sourceId,
      status: 'ok',
      trailId: registration.trail.id,
    });
  } catch (error) {
    const cause = errorFromUnknown(error);
    options.logger?.error('Scheduled trail rejected unexpectedly', {
      error: cause.message,
      sourceId: registration.sourceId,
      trailId: registration.trail.id,
    });
    await emitRunRecord(options, {
      activation,
      error: cause,
      sourceId: registration.sourceId,
      status: 'err',
      trailId: registration.trail.id,
    });
  }
};

const mergeContextOverrides = (
  base: TrailContextInit,
  options: ScheduleRuntimeOptions
): TrailContextInit => {
  const withCtx =
    options.ctx === undefined
      ? base
      : {
          ...base,
          ...options.ctx,
          extensions: { ...base.extensions, ...options.ctx.extensions },
        };

  return options.abortSignal === undefined
    ? withCtx
    : { ...withCtx, abortSignal: options.abortSignal };
};

const createDrainContext = async (
  options: ScheduleRuntimeOptions
): Promise<TrailContext> => {
  const seed =
    options.createContext === undefined
      ? undefined
      : await options.createContext();
  const base = createTrailContext(seed);
  return createTrailContext(mergeContextOverrides(base, options));
};

const stopCronJobs = (
  registrations: readonly RunningScheduleRegistration[]
): Error[] => {
  const failures: Error[] = [];
  for (const registration of registrations) {
    try {
      registration.job.stop();
    } catch (error) {
      failures.push(errorFromUnknown(error));
    }
  }
  return failures;
};

const startFailure = (
  registration: ScheduleActivationRegistration,
  error: unknown
): InternalError => {
  const cause = errorFromUnknown(error);
  return new InternalError(
    `Schedule source "${registration.sourceId}" failed to register for trail "${registration.trail.id}": ${cause.message}`,
    {
      cause,
      context: { ...registrationReport(registration) },
    }
  );
};

const stopFailure = (
  failures: readonly Error[],
  report: Omit<ScheduleRuntimeStopReport, 'resources'>,
  drainError?: Error
): InternalError => {
  const primary = failures[0] ?? drainError;
  return new InternalError('Schedule runtime stop failed', {
    ...(primary === undefined ? {} : { cause: primary }),
    context: {
      failures: [
        ...failures.map(errorRecord),
        ...(drainError === undefined ? [] : [errorRecord(drainError)]),
      ],
      settledRuns: report.settledRuns,
      stopped: report.stopped,
    },
  });
};

export const createScheduleRuntime = (
  graph: Topo,
  options: ScheduleRuntimeOptions = {}
): ScheduleRuntime => {
  const cron = options.cron ?? defaultCronFactory;
  const inFlight = new Set<Promise<void>>();
  let state: ScheduleRuntimeState = 'idle';
  let running: RunningScheduleRegistration[] = [];

  const runAndTrack = (
    registration: ScheduleActivationRegistration
  ): Promise<void> => {
    const activation = scheduleActivationProvenance(registration);
    if (state !== 'running') {
      return emitRunRecord(options, {
        activation,
        skipReason: 'stopped',
        sourceId: registration.sourceId,
        status: 'skipped',
        trailId: registration.trail.id,
      });
    }

    const execution = executeScheduleActivation(
      graph,
      registration,
      options,
      activation
    );
    inFlight.add(execution);
    void (async () => {
      try {
        await execution;
      } finally {
        inFlight.delete(execution);
      }
    })();
    return execution;
  };

  const start = async (): Promise<
    Result<ScheduleRuntimeStartReport, Error>
  > => {
    if (state !== 'idle') {
      return Result.err(
        new ConflictError(`Schedule runtime cannot start from state "${state}"`)
      );
    }

    const validated = validateTopo(graph);
    if (validated.isErr()) {
      return Result.err(validated.error);
    }

    const registrations = collectScheduleActivations(graph);
    const started: RunningScheduleRegistration[] = [];
    state = 'running';

    for (const registration of registrations) {
      try {
        const job = cron(registration.cron, () => runAndTrack(registration));
        if (options.unref === true) {
          job.unref?.();
        }
        started.push({ ...registration, job });
      } catch (error) {
        state = 'stopping';
        stopCronJobs(started);
        state = 'idle';
        running = [];
        return Result.err(startFailure(registration, error));
      }
    }

    running = started;
    const warnings = collectStartWarnings(running);
    logStartWarnings(warnings, options.logger);
    return Result.ok({
      registered: running.map(registrationReport),
      warnings,
    });
  };

  const stop = async (): Promise<Result<ScheduleRuntimeStopReport, Error>> => {
    if (state === 'idle' || state === 'stopped') {
      return Result.ok({
        resources: { disposed: [], evicted: [] },
        settledRuns: 0,
        stopped: [],
      });
    }
    if (state === 'stopping') {
      return Result.err(
        new ConflictError('Schedule runtime stop is already in progress')
      );
    }

    state = 'stopping';
    const stopping = running;
    const stopped = stopping.map(registrationReport);
    const stopFailures = stopCronJobs(stopping);
    const pending = [...inFlight];
    const settled = await Promise.allSettled(pending);
    const rejectedRuns = settled
      .filter((entry) => entry.status === 'rejected')
      .map((entry) => errorFromUnknown(entry.reason));

    const partialReport = { settledRuns: pending.length, stopped };
    const failures = [...stopFailures, ...rejectedRuns];
    const drained = await (async () => {
      try {
        const drainCtx = await createDrainContext(options);
        return await drainResources(
          graph.listResources(),
          drainCtx,
          options.configValues
        );
      } catch (error) {
        return Result.err(errorFromUnknown(error));
      }
    })();

    running = [];
    state = 'stopped';

    if (drained.isErr() || failures.length > 0) {
      return Result.err(
        stopFailure(
          failures,
          partialReport,
          drained.isErr() ? drained.error : undefined
        )
      );
    }

    return Result.ok({
      resources: drained.value,
      ...partialReport,
    });
  };

  return Object.freeze({
    start,
    state: () => state,
    stop,
  });
};
