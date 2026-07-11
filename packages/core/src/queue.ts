import type {
  ActivationSource,
  ActivationSourceMeta,
  ActivationSourceParse,
} from './activation-source.js';
import { ValidationError } from './errors.js';

export interface QueueSpec<TOutput = unknown> {
  readonly meta?: ActivationSourceMeta | undefined;
  readonly parse: ActivationSourceParse<TOutput>;
  readonly payload?: ActivationSource['payload'] | undefined;
  /**
   * Runtime queue name. Defaults to the source id, so authored queue
   * contracts can stay stable while host bindings choose their own names.
   */
  readonly queue?: string | undefined;
  /** Reserved for future queue-specific design; trail versioning is trail-only. */
  readonly version?: never;
}

export interface QueueSource<TOutput = unknown> extends ActivationSource {
  readonly kind: 'queue';
  readonly meta?: ActivationSourceMeta | undefined;
  readonly parse: ActivationSourceParse<TOutput>;
  readonly payload?: ActivationSource['payload'] | undefined;
  readonly queue: string;
}

export interface QueueValidationIssue {
  readonly field: 'parse' | 'queue';
  readonly message: string;
}

const normalizeQueueName = (queueName: string): string => queueName.trim();

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isZodSchema = (value: unknown): boolean =>
  isObjectRecord(value) && typeof value['safeParse'] === 'function';

const validateQueueName = (queueName: unknown): QueueValidationIssue[] =>
  typeof queueName === 'string' && queueName.trim().length > 0
    ? []
    : [
        {
          field: 'queue',
          message: 'Queue source must define a non-empty queue name',
        },
      ];

const validateRequiredParse = (parse: unknown): QueueValidationIssue[] =>
  parse === undefined
    ? [
        {
          field: 'parse',
          message: 'Queue sources must define parse',
        },
      ]
    : [];

const validateParseShape = (parse: unknown): QueueValidationIssue[] => {
  if (parse === undefined || isZodSchema(parse)) {
    return [];
  }
  if (isObjectRecord(parse) && isZodSchema(parse['output'])) {
    return [];
  }
  return [
    {
      field: 'parse',
      message: 'Queue parse must be a Zod schema or define parse.output',
    },
  ];
};

const queueIssuesMessage = (
  id: string,
  issues: readonly QueueValidationIssue[]
): string =>
  `queue("${id}") is invalid: ${issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')}`;

const assertQueueSpec = <TOutput>(
  id: string,
  spec: QueueSpec<TOutput>
): {
  readonly queue: string;
} => {
  const queueName = spec.queue === undefined ? id : spec.queue;
  const issues = [
    ...validateQueueName(queueName),
    ...validateRequiredParse(spec.parse),
    ...validateParseShape(spec.parse),
  ];

  if (issues.length > 0) {
    throw new ValidationError(queueIssuesMessage(id, issues), {
      context: { issues },
    });
  }

  return { queue: normalizeQueueName(queueName) };
};

export const validateQueueSource = (
  source: ActivationSource
): readonly QueueValidationIssue[] => {
  if (source.kind !== 'queue') {
    return [];
  }

  return [
    ...validateQueueName(source.queue),
    ...validateRequiredParse(source.parse),
    ...validateParseShape(source.parse),
  ];
};

/**
 * Define a queue activation source.
 *
 * Queue sources are inert contract data: they describe which runtime queue
 * wakes a trail and how the message body becomes trail input. A host adapter
 * such as `@ontrails/cloudflare/workers` owns delivery.
 *
 * @example
 * ```ts
 * import { queue } from '@ontrails/core';
 * import { z } from 'zod';
 *
 * const source = queue('queue.email.outbox', {
 *   queue: 'email-outbox',
 *   parse: z.object({ messageId: z.string() }),
 * });
 * ```
 */
export function queue<TOutput>(
  id: string,
  spec: QueueSpec<TOutput>
): QueueSource<TOutput>;
export function queue<TOutput>(
  spec: QueueSpec<TOutput> & { readonly id: string }
): QueueSource<TOutput>;
export function queue<TOutput>(
  idOrSpec: string | (QueueSpec<TOutput> & { readonly id: string }),
  maybeSpec?: QueueSpec<TOutput>
): QueueSource<TOutput> {
  const id = typeof idOrSpec === 'string' ? idOrSpec : idOrSpec.id;
  // oxlint-disable-next-line no-non-null-assertion -- overload guarantees maybeSpec when idOrSpec is string
  const spec = typeof idOrSpec === 'string' ? maybeSpec! : idOrSpec;
  const normalized = assertQueueSpec(id, spec);

  return Object.freeze({
    id,
    kind: 'queue' as const,
    parse: spec.parse,
    queue: normalized.queue,
    ...(spec.meta === undefined
      ? {}
      : { meta: Object.freeze({ ...spec.meta }) }),
    ...(spec.payload === undefined ? {} : { payload: spec.payload }),
  });
}
