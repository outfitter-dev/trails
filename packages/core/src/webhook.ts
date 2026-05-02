import type {
  ActivationSource,
  ActivationSourceMeta,
  ActivationSourceParse,
} from './activation-source.js';
import { ValidationError } from './errors.js';

export const webhookMethods = Object.freeze([
  'DELETE',
  'GET',
  'PATCH',
  'POST',
  'PUT',
] as const);

export type WebhookMethod = (typeof webhookMethods)[number];
export type WebhookMethodInput = WebhookMethod | Lowercase<WebhookMethod>;

export interface WebhookSpec<TOutput = unknown> {
  readonly meta?: ActivationSourceMeta | undefined;
  readonly method?: WebhookMethodInput | undefined;
  readonly parse: ActivationSourceParse<TOutput>;
  readonly path: string;
  readonly payload?: ActivationSource['payload'] | undefined;
}

export interface WebhookSource<TOutput = unknown> extends ActivationSource {
  readonly kind: 'webhook';
  readonly meta?: ActivationSourceMeta | undefined;
  readonly method: WebhookMethod;
  readonly parse: ActivationSourceParse<TOutput>;
  readonly path: string;
  readonly payload?: ActivationSource['payload'] | undefined;
}

export interface WebhookValidationIssue {
  readonly field: 'method' | 'parse' | 'path';
  readonly message: string;
}

const DEFAULT_WEBHOOK_METHOD = 'POST' as const;

const normalizeMethod = (
  method: WebhookMethodInput | string | undefined
): string => (method ?? DEFAULT_WEBHOOK_METHOD).trim().toUpperCase();

const normalizePath = (path: string): string => path.trim();

const isWebhookMethod = (method: string): method is WebhookMethod =>
  (webhookMethods as readonly string[]).includes(method);

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isZodSchema = (value: unknown): boolean =>
  isObjectRecord(value) && typeof value['safeParse'] === 'function';

const validateMethod = (
  method: WebhookMethodInput | string | undefined
): WebhookValidationIssue[] => {
  const normalized = normalizeMethod(method);
  return isWebhookMethod(normalized)
    ? []
    : [
        {
          field: 'method',
          message: `Webhook method must be one of ${webhookMethods.join(', ')}`,
        },
      ];
};

const validatePath = (path: unknown): WebhookValidationIssue[] => {
  if (typeof path !== 'string' || path.trim().length === 0) {
    return [
      {
        field: 'path',
        message: 'Webhook path must be a non-empty absolute path',
      },
    ];
  }

  const normalized = normalizePath(path);
  return normalized.startsWith('/')
    ? []
    : [
        {
          field: 'path',
          message: 'Webhook path must start with "/"',
        },
      ];
};

const validateRequiredParse = (parse: unknown): WebhookValidationIssue[] =>
  parse === undefined
    ? [
        {
          field: 'parse',
          message: 'Webhook sources must define parse',
        },
      ]
    : [];

const validateParseShape = (parse: unknown): WebhookValidationIssue[] => {
  if (parse === undefined || isZodSchema(parse)) {
    return [];
  }
  if (isObjectRecord(parse) && isZodSchema(parse['output'])) {
    return [];
  }
  return [
    {
      field: 'parse',
      message: 'Webhook parse must be a Zod schema or define parse.output',
    },
  ];
};

const webhookIssuesMessage = (
  id: string,
  issues: readonly WebhookValidationIssue[]
): string =>
  `webhook("${id}") is invalid: ${issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')}`;

const assertWebhookSpec = <TOutput>(
  id: string,
  spec: WebhookSpec<TOutput>
): {
  readonly method: WebhookMethod;
  readonly path: string;
} => {
  const issues = [
    ...validateMethod(spec.method),
    ...validatePath(spec.path),
    ...validateRequiredParse(spec.parse),
    ...validateParseShape(spec.parse),
  ];

  if (issues.length > 0) {
    throw new ValidationError(webhookIssuesMessage(id, issues), {
      context: { issues },
    });
  }

  return {
    method: normalizeMethod(spec.method) as WebhookMethod,
    path: normalizePath(spec.path),
  };
};

export const validateWebhookSource = (
  source: ActivationSource
): readonly WebhookValidationIssue[] => {
  if (source.kind !== 'webhook') {
    return [];
  }

  return [
    ...validateMethod(source.method),
    ...validatePath(source.path),
    ...validateRequiredParse(source.parse),
    ...validateParseShape(source.parse),
  ];
};

export function webhook<TOutput>(
  id: string,
  spec: WebhookSpec<TOutput>
): WebhookSource<TOutput>;
export function webhook<TOutput>(
  spec: WebhookSpec<TOutput> & { readonly id: string }
): WebhookSource<TOutput>;
export function webhook<TOutput>(
  idOrSpec: string | (WebhookSpec<TOutput> & { readonly id: string }),
  maybeSpec?: WebhookSpec<TOutput>
): WebhookSource<TOutput> {
  const id = typeof idOrSpec === 'string' ? idOrSpec : idOrSpec.id;
  // oxlint-disable-next-line no-non-null-assertion -- overload guarantees maybeSpec when idOrSpec is string
  const spec = typeof idOrSpec === 'string' ? maybeSpec! : idOrSpec;
  const normalized = assertWebhookSpec(id, spec);

  return Object.freeze({
    id,
    kind: 'webhook' as const,
    method: normalized.method,
    parse: spec.parse,
    path: normalized.path,
    ...(spec.meta === undefined
      ? {}
      : { meta: Object.freeze({ ...spec.meta }) }),
    ...(spec.payload === undefined ? {} : { payload: spec.payload }),
  });
}
