import type {
  ActivationSource,
  ActivationSourceMeta,
  ActivationSourceParse,
} from './activation-source.js';
import { InternalError, ValidationError } from './errors.js';
import type { AnyResource } from './resource.js';
import { Result } from './result.js';
import type { TrailContext } from './types.js';

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

/**
 * Verification callback for inbound webhook requests.
 *
 * When the source declares `resources`, surfaces call `verify` with a
 * resource-capable context so signature checks can reach declared
 * resources (e.g. a store holding per-endpoint secrets). Verifiers that
 * only need the request may ignore the second parameter.
 */
export type WebhookVerify = (
  request: WebhookVerifyRequest,
  ctx?: TrailContext
) => Promise<Result<void, Error>> | Result<void, Error>;

export interface WebhookSpec<TOutput = unknown> {
  /**
   * Allowlist of header names delivered to the consumer trail. When set,
   * the webhook envelope includes a `headers` map with the matching
   * headers, lowercased. Headers outside the allowlist never reach the
   * trail boundary.
   */
  readonly headers?: readonly string[] | undefined;
  readonly meta?: ActivationSourceMeta | undefined;
  readonly method?: WebhookMethodInput | undefined;
  readonly parse: ActivationSourceParse<TOutput>;
  /**
   * Absolute path, optionally with dynamic segments (`/hooks/:endpoint`).
   * Segment values are delivered as fields of the webhook envelope under
   * their segment names.
   */
  readonly path: string;
  readonly payload?: ActivationSource['payload'] | undefined;
  /**
   * Deliver the raw request body text to the consumer trail as a
   * `rawBody` envelope field. With `rawBody`, a non-JSON body no longer
   * fails at the surface — the trail owns payload interpretation (e.g.
   * HMAC verification over exact bytes).
   */
  readonly rawBody?: boolean | undefined;
  /** Resources the `verify` callback may access through its context. */
  readonly resources?: readonly AnyResource[] | undefined;
  readonly verify?: WebhookVerify | undefined;
  /** Reserved for future webhook-specific design; trail versioning is trail-only. */
  readonly version?: never;
}

export interface WebhookSource<TOutput = unknown> extends ActivationSource {
  readonly kind: 'webhook';
  readonly headers?: readonly string[] | undefined;
  readonly meta?: ActivationSourceMeta | undefined;
  readonly method: WebhookMethod;
  readonly parse: ActivationSourceParse<TOutput>;
  readonly path: string;
  /** Dynamic segment names parsed from `path`, in order. Empty for static paths. */
  readonly pathParams: readonly string[];
  readonly payload?: ActivationSource['payload'] | undefined;
  readonly rawBody?: boolean | undefined;
  readonly resources?: readonly AnyResource[] | undefined;
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

const WEBHOOK_PATH_PARAM_PATTERN = /^:[A-Za-z_][A-Za-z0-9_]*$/;

/** Envelope field names a path segment must not shadow. */
const RESERVED_ENVELOPE_FIELDS = new Set(['body', 'headers', 'rawBody']);

const pathSegments = (path: string): readonly string[] =>
  normalizePath(path).split('/').slice(1);

const isParamSegment = (segment: string): boolean => segment.startsWith(':');

/** Decode a path segment, keeping the raw text when the encoding is malformed. */
const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * Parse the dynamic segment names out of a webhook path pattern.
 *
 * @example
 * ```ts
 * parseWebhookPathParams('/hooks/:endpoint'); // ['endpoint']
 * parseWebhookPathParams('/webhooks/payment'); // []
 * ```
 */
export const parseWebhookPathParams = (path: string): readonly string[] =>
  pathSegments(path)
    .filter((segment) => isParamSegment(segment))
    .map((segment) => segment.slice(1));

/**
 * Match a concrete request path against a webhook path pattern.
 *
 * Returns the captured segment values keyed by segment name, or
 * `undefined` when the path does not match. Static patterns match only
 * themselves and capture nothing.
 *
 * @example
 * ```ts
 * matchWebhookPath('/hooks/:endpoint', '/hooks/github');
 * // { endpoint: 'github' }
 * ```
 */
export const matchWebhookPath = (
  pattern: string,
  path: string
): Readonly<Record<string, string>> | undefined => {
  const patternSegments = pathSegments(pattern);
  const actualSegments = path.split('/').slice(1);
  if (patternSegments.length !== actualSegments.length) {
    return undefined;
  }

  const params: Record<string, string> = {};
  for (const [index, patternSegment] of patternSegments.entries()) {
    const actual = actualSegments[index] ?? '';
    if (isParamSegment(patternSegment)) {
      if (actual.length === 0) {
        return undefined;
      }
      params[patternSegment.slice(1)] = decodeSegment(actual);
      continue;
    }
    if (patternSegment !== actual) {
      return undefined;
    }
  }
  return params;
};

/**
 * True when two webhook path patterns can both match one concrete path.
 *
 * Segment-wise: two literals overlap only when equal; a dynamic segment
 * overlaps anything. Used by governance to extend route-collision
 * detection past exact-path equality.
 *
 * @example
 * ```ts
 * webhookPathPatternsOverlap('/hooks/:a', '/hooks/github'); // true
 * webhookPathPatternsOverlap('/hooks/:a', '/api/:b'); // false
 * ```
 */
export const webhookPathPatternsOverlap = (
  left: string,
  right: string
): boolean => {
  const leftSegments = pathSegments(left);
  const rightSegments = pathSegments(right);
  if (leftSegments.length !== rightSegments.length) {
    return false;
  }
  return leftSegments.every((leftSegment, index) => {
    const rightSegment = rightSegments[index] ?? '';
    return (
      isParamSegment(leftSegment) ||
      isParamSegment(rightSegment) ||
      leftSegment === rightSegment
    );
  });
};

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
  if (!normalized.startsWith('/')) {
    return [
      {
        field: 'path',
        message: 'Webhook path must start with "/"',
      },
    ];
  }

  const issues: WebhookValidationIssue[] = [];
  for (const segment of pathSegments(normalized)) {
    if (isParamSegment(segment) && !WEBHOOK_PATH_PARAM_PATTERN.test(segment)) {
      issues.push({
        field: 'path',
        message: `Webhook path segment "${segment}" must match :name with a letter or underscore first`,
      });
    }
  }

  const params = parseWebhookPathParams(normalized);
  if (new Set(params).size !== params.length) {
    issues.push({
      field: 'path',
      message: 'Webhook path segments must use unique names',
    });
  }
  for (const param of params) {
    if (RESERVED_ENVELOPE_FIELDS.has(param)) {
      issues.push({
        field: 'path',
        message: `Webhook path segment ":${param}" collides with the reserved envelope field "${param}"`,
      });
    }
  }

  return issues;
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
  request: WebhookVerifyRequest,
  ctx?: TrailContext
): Promise<Result<void, Error>> => {
  if (source.verify === undefined) {
    return Result.ok();
  }

  try {
    return await source.verify(request, ctx);
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
    pathParams: Object.freeze([...parseWebhookPathParams(normalized.path)]),
    ...(spec.headers === undefined
      ? {}
      : {
          headers: Object.freeze(
            spec.headers.map((name) => name.toLowerCase())
          ),
        }),
    ...(spec.meta === undefined
      ? {}
      : { meta: Object.freeze({ ...spec.meta }) }),
    ...(spec.payload === undefined ? {} : { payload: spec.payload }),
    ...(spec.rawBody === undefined ? {} : { rawBody: spec.rawBody }),
    ...(spec.resources === undefined
      ? {}
      : { resources: Object.freeze([...spec.resources]) }),
    ...(spec.verify === undefined ? {} : { verify: spec.verify }),
  });
}
