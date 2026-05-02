import type {
  ActivationSource,
  ActivationSourceMeta,
  ActivationSourceParse,
} from './activation-source.js';
import { InternalError, ValidationError } from './errors.js';
import { Result } from './result.js';

export const webhookMethods = Object.freeze([
  'DELETE',
  'GET',
  'PATCH',
  'POST',
  'PUT',
] as const);

export type WebhookMethod = (typeof webhookMethods)[number];
export type WebhookMethodInput = WebhookMethod | Lowercase<WebhookMethod>;

export type WebhookVerifyHeaders = Readonly<
  Record<string, readonly string[] | string | undefined>
>;

export interface WebhookVerifyRequest {
  readonly body: ArrayBuffer | Uint8Array | string;
  readonly headers: WebhookVerifyHeaders;
  readonly method: string;
  readonly path: string;
}

export type WebhookVerify = (
  request: WebhookVerifyRequest
) => Promise<Result<void, Error>> | Result<void, Error>;

export interface WebhookSpec<TOutput = unknown> {
  readonly meta?: ActivationSourceMeta | undefined;
  readonly method?: WebhookMethodInput | undefined;
  readonly parse: ActivationSourceParse<TOutput>;
  readonly path: string;
  readonly payload?: ActivationSource['payload'] | undefined;
  readonly verify?: WebhookVerify | undefined;
}

export interface WebhookSource<TOutput = unknown> extends ActivationSource {
  readonly kind: 'webhook';
  readonly meta?: ActivationSourceMeta | undefined;
  readonly method: WebhookMethod;
  readonly parse: ActivationSourceParse<TOutput>;
  readonly path: string;
  readonly payload?: ActivationSource['payload'] | undefined;
  readonly verify?: WebhookVerify | undefined;
}

export interface WebhookValidationIssue {
  readonly field: 'method' | 'parse' | 'path' | 'verify';
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

const validateVerify = (verify: unknown): WebhookValidationIssue[] =>
  verify === undefined || typeof verify === 'function'
    ? []
    : [
        {
          field: 'verify',
          message: 'Webhook verify must be a function when provided',
        },
      ];

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
    ...validateVerify(spec.verify),
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
    ...validateVerify(source.verify),
  ];
};

const errorFromUnknown = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const getWebhookHeaders = (
  request: Pick<WebhookVerifyRequest, 'headers'>,
  name: string
): readonly string[] => {
  const normalized = name.toLowerCase();
  const matches: string[] = [];
  for (const [headerName, value] of Object.entries(request.headers)) {
    if (headerName.toLowerCase() !== normalized) {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (typeof value === 'string') {
      matches.push(value);
    } else {
      matches.push(...value);
    }
  }
  return matches;
};

export const getWebhookHeader = (
  request: Pick<WebhookVerifyRequest, 'headers'>,
  name: string
): string | undefined => {
  const [first] = getWebhookHeaders(request, name);
  return first;
};

export const verifyWebhookRequest = async (
  source: Pick<WebhookSource, 'id' | 'verify'>,
  request: WebhookVerifyRequest
): Promise<Result<void, Error>> => {
  if (source.verify === undefined) {
    return Result.ok();
  }

  try {
    return await source.verify(request);
  } catch (error) {
    const cause = errorFromUnknown(error);
    return Result.err(
      new InternalError(`Webhook source "${source.id}" verification threw`, {
        cause,
      })
    );
  }
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
    ...(spec.verify === undefined ? {} : { verify: spec.verify }),
  });
}
