import { z } from 'zod';

import { InternalError } from '../errors.js';
import { composeLayers } from '../layer.js';
import type { Layer } from '../layer.js';
import { Result } from '../result.js';
import type { Signal } from '../signal.js';
import { trail } from '../trail.js';
import type { Trail, TrailExample, TrailSpec } from '../trail.js';
import type { TrailContext } from '../types.js';

type SchemaValue<TSchema extends z.ZodType> = z.output<TSchema>;

type ExampleBearingSchema<TSchema extends z.ZodType> = TSchema & {
  readonly examples?: readonly Partial<SchemaValue<TSchema>>[] | undefined;
};

interface IngestBaseOptions<TSchema extends z.ZodType, TSignal> extends Omit<
  TrailSpec<SchemaValue<TSchema>, void>,
  'blaze' | 'examples' | 'fires' | 'input' | 'intent' | 'output' | 'pattern'
> {
  /** Override the derived trail id. Defaults to `${signal}.ingest`. */
  readonly id?: string | undefined;
  /** Validated external payload shape. */
  readonly schema: TSchema;
  /** Signal to fire after verification and optional transformation. */
  readonly signal: Signal<TSignal>;
  /** Optional per-trail verification layer, e.g. HMAC signature checks. */
  readonly verify?: Layer | undefined;
}

export type IngestTransform<TInput, TSignal> = (
  payload: TInput,
  ctx: TrailContext
) => TSignal | Promise<TSignal>;

export interface IngestOptions<
  TSchema extends z.ZodType,
  TSignal,
> extends IngestBaseOptions<TSchema, TSignal> {
  readonly transform?:
    | IngestTransform<SchemaValue<TSchema>, TSignal>
    | undefined;
}

const deriveExampleName = (signalId: string, index: number): string =>
  `Ingest ${signalId} ${index + 1}`;

const deriveExamples = <TSchema extends z.ZodType>(
  schema: ExampleBearingSchema<TSchema>,
  signalId: string
): readonly TrailExample<SchemaValue<TSchema>, void>[] | undefined => {
  const { examples } = schema;
  if (examples === undefined || examples.length === 0) {
    return undefined;
  }

  return Object.freeze(
    examples.map((example, index) => ({
      input: example,
      name: deriveExampleName(signalId, index),
    }))
  );
};

const createIngestBlaze =
  <TSchema extends z.ZodType, TSignal>(
    signalRef: Signal<TSignal>,
    signalId: string,
    trailId: string,
    transform: IngestTransform<SchemaValue<TSchema>, TSignal> | undefined
  ) =>
  async (
    input: SchemaValue<TSchema>,
    ctx: TrailContext
  ): Promise<Result<void, Error>> => {
    if (ctx.fire === undefined) {
      return Result.err(
        new InternalError(
          `ingest("${trailId}") requires topo-backed execution to fire "${signalId}"`
        )
      );
    }

    try {
      const payload =
        transform === undefined
          ? (input as TSignal)
          : await transform(input, ctx);
      await ctx.fire(signalRef, payload);
      return Result.ok();
    } catch (error) {
      const message = `ingest("${trailId}"): ${error instanceof Error ? error.message : String(error)}`;
      return Result.err(
        error instanceof Error
          ? new InternalError(message, { cause: error })
          : new InternalError(message)
      );
    }
  };

export const ingest = <
  TSchema extends z.ZodType,
  TSignal = SchemaValue<TSchema>,
>(
  options: IngestOptions<TSchema, TSignal>
): Trail<SchemaValue<TSchema>, void> => {
  const signalId = options.signal.id;
  const id = options.id ?? `${signalId}.ingest`;
  const { id: _id, schema, signal, transform, verify, ...trailSpec } = options;
  const baseBlaze = createIngestBlaze<TSchema, TSignal>(
    signal,
    signalId,
    id,
    transform
  );
  const baseTrail = trail(id, {
    ...trailSpec,
    blaze: baseBlaze,
    examples: deriveExamples(schema as ExampleBearingSchema<TSchema>, signalId),
    fires: [signal],
    input: schema as z.ZodType<SchemaValue<TSchema>>,
    intent: 'write',
    output: z.void(),
    pattern: 'ingest',
  }) as Trail<SchemaValue<TSchema>, void>;

  if (verify === undefined) {
    return baseTrail;
  }

  // Verification is a per-factory concern, so compose it locally instead of
  // mutating runner-wide layer configuration.
  return Object.freeze({
    ...baseTrail,
    blaze: composeLayers([verify], baseTrail, baseTrail.blaze),
  }) as Trail<SchemaValue<TSchema>, void>;
};
