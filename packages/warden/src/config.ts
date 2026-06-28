import { z } from 'zod';

import type { WardenDiagnostic } from './rules/types.js';

export const wardenDepthValues = ['source', 'project', 'topo', 'all'] as const;
export const wardenFailOnValues = ['error', 'warning'] as const;
export const wardenFormatValues = ['summary', 'github', 'json'] as const;
export const wardenLockValues = ['auto', 'cached', 'refresh', 'skip'] as const;
export const wardenDraftsValues = ['include', 'exclude', 'only'] as const;

const appNameSchema = z.string().min(1);

const wardenJurisdictionSchema = z
  .object({
    ignore: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({ ignore: [] });

const wardenConfigObjectSchema = z
  .object({
    apps: z.array(appNameSchema).min(1).optional(),
    depth: z.enum(wardenDepthValues).default('all'),
    drafts: z.enum(wardenDraftsValues).default('include'),
    failOn: z.enum(wardenFailOnValues).default('error'),
    format: z.enum(wardenFormatValues).default('summary'),
    jurisdiction: wardenJurisdictionSchema,
    lock: z.enum(wardenLockValues).default('auto'),
  })
  .strict();

export const wardenConfigSchema = wardenConfigObjectSchema
  .optional()
  .transform((value) => wardenConfigObjectSchema.parse(value ?? {}));

export type WardenConfig = z.output<typeof wardenConfigSchema>;
export type WardenConfigInput = z.input<typeof wardenConfigSchema>;
export type WardenDepth = (typeof wardenDepthValues)[number];
export type WardenDraftsMode = (typeof wardenDraftsValues)[number];
export type WardenFailOn = (typeof wardenFailOnValues)[number];
export type WardenFormat = (typeof wardenFormatValues)[number];
export type WardenJurisdiction = z.output<typeof wardenJurisdictionSchema>;
export type WardenLockMode = (typeof wardenLockValues)[number];

export interface WardenConfigLayer extends Partial<WardenConfig> {
  readonly noLockMutation?: boolean | undefined;
}

export interface EffectiveWardenConfig extends WardenConfig {
  readonly noLockMutation: boolean;
}

export interface ResolveWardenConfigOptions {
  readonly cli?: WardenConfigLayer | undefined;
  readonly config?: WardenConfigInput | undefined;
  readonly defaults?: Partial<WardenConfig> | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
}

export interface WardenConfigResolution {
  readonly diagnostics: readonly WardenDiagnostic[];
  readonly effectiveConfig: EffectiveWardenConfig;
}

const baseWardenConfig = (): WardenConfig => {
  const omittedSection: unknown = undefined;
  return wardenConfigSchema.parse(omittedSection);
};

const cleanUndefinedValues = <T extends Record<string, unknown>>(
  value: T
): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;

const splitApps = (value: string): readonly string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const readEnvLayer = (
  env: Record<string, string | undefined>
): Partial<WardenConfig> =>
  cleanUndefinedValues({
    apps: env['TRAILS_APPS'] ? splitApps(env['TRAILS_APPS']) : undefined,
    depth: env['TRAILS_DEPTH'],
    drafts: env['TRAILS_DRAFTS'],
    failOn: env['TRAILS_FAIL_ON'],
    format: env['TRAILS_FORMAT'],
    lock: env['TRAILS_LOCK'],
  }) as Partial<WardenConfig>;

const configDiagnostic = (message: string): WardenDiagnostic => ({
  filePath: '<warden-config>',
  line: 1,
  message,
  rule: 'warden-config',
  severity: 'error',
});

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');

const parseConfigLayer = (
  label: string,
  value: WardenConfigInput | undefined
): {
  readonly data: Partial<WardenConfig>;
  readonly diagnostics: readonly WardenDiagnostic[];
} => {
  if (value === undefined) {
    return { data: {}, diagnostics: [] };
  }

  const parsed = wardenConfigSchema.safeParse(value);
  if (parsed.success) {
    if (typeof value !== 'object' || value === null) {
      return { data: parsed.data, diagnostics: [] };
    }

    return {
      data: Object.fromEntries(
        Object.keys(value).map((key) => [
          key,
          parsed.data[key as keyof WardenConfig],
        ])
      ) as Partial<WardenConfig>,
      diagnostics: [],
    };
  }

  return {
    data: {},
    diagnostics: [
      configDiagnostic(
        `Invalid ${label} Warden config: ${formatIssues(parsed.error)}`
      ),
    ],
  };
};

export const resolveWardenConfig = ({
  cli,
  config,
  defaults,
  env = {},
}: ResolveWardenConfigOptions = {}): WardenConfigResolution => {
  const { noLockMutation = false, ...cliConfig } = cli ?? {};
  const defaultLayer = wardenConfigSchema.parse({
    ...baseWardenConfig(),
    ...defaults,
  });
  const configLayer = parseConfigLayer('file', config);
  const envLayer = parseConfigLayer('environment', readEnvLayer(env));
  const merged = {
    ...defaultLayer,
    ...configLayer.data,
    ...envLayer.data,
    ...cleanUndefinedValues(cliConfig),
  };
  const parsed = wardenConfigSchema.safeParse(merged);
  const diagnostics = [...configLayer.diagnostics, ...envLayer.diagnostics];

  if (!parsed.success) {
    return {
      diagnostics: [
        ...diagnostics,
        configDiagnostic(
          `Invalid effective Warden config: ${formatIssues(parsed.error)}`
        ),
      ],
      effectiveConfig: {
        ...defaultLayer,
        noLockMutation,
      },
    };
  }

  return {
    diagnostics,
    effectiveConfig: {
      ...parsed.data,
      noLockMutation,
    },
  };
};
