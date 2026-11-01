/**
 * Cloudflare Cron Triggers materializer for core `schedule()` activation
 * sources.
 *
 * The Worker's `scheduled(controller, env, ctx)` entrypoint fires once per
 * configured cron. This module matches `controller.cron` against the topo's
 * normalized schedule crons and runs every matching trail through the shared
 * pipeline with activation provenance, the same way the `/queues`
 * materializer dispatches queue messages.
 *
 * Cron Triggers run in UTC only, so a `schedule()` that declares any other
 * timezone fails at materialization with a {@link ValidationError} carrying
 * the `cloudflare_cron_utc_only` code instead of silently drifting.
 */

import {
  buildActivationProvenanceTraceAttrs,
  getActivationWherePredicate,
  getTraceSink,
  InternalError,
  isTrailsError,
  matchesTrailPattern,
  run,
  TRACE_CONTEXT_KEY,
  traceContextFromRecord,
  validateSurfaceTopo,
  ValidationError,
  withActivationProvenance,
  writeActivationTraceRecord,
} from '@ontrails/core';
import { normalizeCron } from '../cron.js';
import type {
  ActivationEntry,
  AnyTrail,
  BaseSurfaceOptions,
  Layer,
  ResourceOverrideMap,
  Topo,
  TraceContext,
  TrailContextInit,
} from '@ontrails/core';

/** The `ScheduledController` the Workers runtime passes to `scheduled()`. */
export interface CloudflareScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
  noRetry(): void;
}

export type CloudflareScheduledHandler = (
  controller: CloudflareScheduledController
) => Promise<void>;

export interface CreateScheduledHandlerOptions extends BaseSurfaceOptions {
  readonly abortSignal?: AbortSignal | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
}

/** Context code on the materialization error for a non-UTC schedule. */
export const CLOUDFLARE_CRON_UTC_ONLY = 'cloudflare_cron_utc_only';

interface ScheduleRegistration {
  readonly activation: ActivationEntry;
  readonly cron: string;
  readonly input: unknown;
  readonly sourceId: string;
  readonly timezone: string | undefined;
  readonly trail: AnyTrail;
}

const EMPTY_INPUT: Readonly<Record<string, never>> = Object.freeze({});

const isUtc = (timezone: string | undefined): boolean =>
  timezone === undefined || timezone === 'UTC' || timezone === 'Etc/UTC';

const matchesAnyPattern = (
  trailId: string,
  patterns: readonly string[] | undefined
): boolean =>
  patterns !== undefined &&
  patterns.some((pattern) => matchesTrailPattern(trailId, pattern));

const isEligible = (
  graphTrail: AnyTrail,
  options: CreateScheduledHandlerOptions
): boolean => {
  const internal =
    graphTrail.visibility === 'internal' ||
    graphTrail.meta?.['internal'] === true;
  if (internal && !options.include?.includes(graphTrail.id)) {
    return false;
  }
  if (matchesAnyPattern(graphTrail.id, options.exclude)) {
    return false;
  }
  if (
    options.include !== undefined &&
    options.include.length > 0 &&
    !matchesAnyPattern(graphTrail.id, options.include)
  ) {
    return false;
  }
  return (
    options.intent === undefined ||
    options.intent.length === 0 ||
    options.intent.includes(graphTrail.intent)
  );
};

const sourceInput = (activation: ActivationEntry): unknown =>
  Object.hasOwn(activation.source, 'input')
    ? activation.source.input
    : EMPTY_INPUT;

const collectScheduleRegistrations = (
  graph: Topo,
  options: CreateScheduledHandlerOptions
): readonly ScheduleRegistration[] => {
  const registrations: ScheduleRegistration[] = [];
  for (const graphTrail of graph.list()) {
    if (!isEligible(graphTrail, options)) {
      continue;
    }
    for (const activation of graphTrail.activationSources) {
      if (
        activation.source.kind !== 'schedule' ||
        typeof activation.source.cron !== 'string'
      ) {
        continue;
      }
      registrations.push({
        activation,
        cron: normalizeCron(activation.source.cron),
        input: sourceInput(activation),
        sourceId: activation.source.id,
        timezone: activation.source.timezone,
        trail: graphTrail,
      });
    }
  }
  return registrations;
};

const assertUtcOnly = (
  registrations: readonly ScheduleRegistration[]
): void => {
  const first = registrations.find(
    (registration) => !isUtc(registration.timezone)
  );
  if (first === undefined) {
    return;
  }
  throw new ValidationError(
    `Cloudflare Cron Triggers run in UTC only; schedule "${first.sourceId}" on trail "${first.trail.id}" declares timezone "${first.timezone ?? ''}". Remove the timezone or express the cron in UTC.`,
    {
      context: {
        code: CLOUDFLARE_CRON_UTC_ONLY,
        sourceId: first.sourceId,
        timezone: first.timezone,
        trailId: first.trail.id,
      },
    }
  );
};

const createFireId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const activationFor = (
  registration: ScheduleRegistration,
  controller: CloudflareScheduledController
) => {
  const fireId = createFireId();
  return {
    fireId,
    rootFireId: fireId,
    source: {
      cron: registration.cron,
      id: registration.sourceId,
      kind: 'schedule' as const,
      ...(registration.activation.source.meta === undefined
        ? {}
        : { meta: registration.activation.source.meta }),
      ...(registration.timezone === undefined
        ? {}
        : { timezone: registration.timezone }),
    },
    trigger: {
      cron: controller.cron,
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
    },
  };
};

const recordScheduledActivationTrace = async (
  graph: Topo,
  registration: ScheduleRegistration,
  activation: ReturnType<typeof activationFor>,
  status: 'err' | 'ok',
  error?: Error | undefined
): Promise<TraceContext | undefined> => {
  const record = await writeActivationTraceRecord(
    'activation.scheduled',
    {
      ...buildActivationProvenanceTraceAttrs(activation),
      'trails.activation.schedule.cron': activation.trigger.cron,
      'trails.activation.schedule.scheduled_time':
        activation.trigger.scheduledTime,
      'trails.activation.target_trail.id': registration.trail.id,
    },
    status,
    isTrailsError(error) ? error.category : undefined,
    undefined,
    graph.observe?.trace ?? getTraceSink()
  );
  return record === undefined ? undefined : traceContextFromRecord(record);
};

const contextForActivation = (
  activation: ReturnType<typeof activationFor>,
  traceContext: TraceContext | undefined
): Partial<TrailContextInit> =>
  withActivationProvenance(
    {
      extensions:
        traceContext === undefined ? {} : { [TRACE_CONTEXT_KEY]: traceContext },
    },
    activation
  );

const errorFromUnknown = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const shouldRun = async (
  registration: ScheduleRegistration
): Promise<boolean> => {
  const predicate = getActivationWherePredicate(registration.activation.where);
  if (predicate === undefined) {
    return true;
  }
  try {
    return await predicate(registration.input);
  } catch (error: unknown) {
    // Same policy as core's schedule runtime (`packages/core/src/schedule-runtime.ts`,
    // `where_error`): a throwing predicate skips this activation and is
    // reported, rather than failing the whole invocation.
    console.warn(
      `[ontrails:cloudflare/schedules] Schedule activation predicate failed for source "${registration.sourceId}" and trail "${registration.trail.id}"; skipping this activation`,
      { error: errorFromUnknown(error).message }
    );
    return false;
  }
};

const runRegistration = async (
  graph: Topo,
  registration: ScheduleRegistration,
  controller: CloudflareScheduledController,
  options: CreateScheduledHandlerOptions
): Promise<Error | undefined> => {
  const activation = activationFor(registration, controller);
  let proceed: boolean;
  try {
    proceed = await shouldRun(registration);
  } catch (error: unknown) {
    const failure = errorFromUnknown(error);
    await recordScheduledActivationTrace(
      graph,
      registration,
      activation,
      'err',
      failure
    );
    return failure;
  }
  if (!proceed) {
    return undefined;
  }
  const traceContext = await recordScheduledActivationTrace(
    graph,
    registration,
    activation,
    'ok'
  );
  const result = await run(graph, registration.trail.id, registration.input, {
    ...(options.abortSignal === undefined
      ? {}
      : { abortSignal: options.abortSignal }),
    configValues: options.configValues,
    createContext: options.createContext,
    ctx: contextForActivation(activation, traceContext),
    resources: options.resources,
    surfaceLayers: options.layers,
    topoLayers: graph.layers,
  });
  return result.isOk() ? undefined : result.error;
};

/**
 * Build a Cloudflare `scheduled()` handler for a topo.
 *
 * Every core `schedule()` source whose normalized cron equals
 * `controller.cron` runs its trail through the shared pipeline. An unmatched
 * cron is a no-op. Trail failures are collected and rethrown as one
 * {@link InternalError} so the Cron Trigger invocation reports failure;
 * `controller.noRetry()` is called when no failure is retryable.
 *
 * @example
 * ```ts
 * import { createScheduledHandler } from '@ontrails/cloudflare/schedules';
 *
 * export const scheduled = createScheduledHandler(graph);
 * ```
 */
export const createScheduledHandler = (
  graph: Topo,
  options: CreateScheduledHandlerOptions = {}
): CloudflareScheduledHandler => {
  const validated = validateSurfaceTopo(graph, options);
  if (validated.isErr()) {
    throw validated.error;
  }
  const registrations = collectScheduleRegistrations(graph, options);
  assertUtcOnly(registrations);

  return async (controller) => {
    const cron = normalizeCron(controller.cron);
    const failures: Error[] = [];
    for (const registration of registrations) {
      if (registration.cron !== cron) {
        continue;
      }
      const failure = await runRegistration(
        graph,
        registration,
        controller,
        options
      );
      if (failure !== undefined) {
        failures.push(failure);
      }
    }
    if (failures.length === 0) {
      return;
    }
    if (failures.every((error) => isTrailsError(error) && !error.retryable)) {
      controller.noRetry();
    }
    const [firstFailure] = failures;
    throw new InternalError(
      `Scheduled cron "${controller.cron}" failed ${failures.length} of its trails: ${failures.map((error) => error.message).join('; ')}`,
      {
        ...(firstFailure === undefined ? {} : { cause: firstFailure }),
        context: { cron: controller.cron },
      }
    );
  };
};
