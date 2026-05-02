import type {
  ActivationSourceKind,
  ActivationSourceMeta,
} from './activation-source.js';

export const ACTIVATION_PROVENANCE_KEY =
  '__trails_activation_provenance' as const;

export interface ActivationProvenanceSource {
  readonly cron?: string | undefined;
  readonly id: string;
  readonly kind: ActivationSourceKind;
  readonly meta?: ActivationSourceMeta | undefined;
  readonly producerTrailId?: string | undefined;
  readonly timezone?: string | undefined;
}

export interface ActivationProvenance {
  readonly fireId: string;
  readonly parentFireId?: string | undefined;
  readonly rootFireId: string;
  readonly source: ActivationProvenanceSource;
}

export interface ActivationProvenanceCarrier {
  readonly activation?: ActivationProvenance | undefined;
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';

const isActivationProvenanceSource = (
  value: unknown
): value is ActivationProvenanceSource =>
  isObjectRecord(value) &&
  typeof value['id'] === 'string' &&
  typeof value['kind'] === 'string' &&
  optionalString(value['cron']) &&
  optionalString(value['producerTrailId']) &&
  optionalString(value['timezone']) &&
  (value['meta'] === undefined || isObjectRecord(value['meta']));

const isActivationProvenance = (
  value: unknown
): value is ActivationProvenance =>
  isObjectRecord(value) &&
  typeof value['fireId'] === 'string' &&
  optionalString(value['parentFireId']) &&
  typeof value['rootFireId'] === 'string' &&
  isActivationProvenanceSource(value['source']);

export const getActivationProvenance = (
  ctx: ActivationProvenanceCarrier | undefined
): ActivationProvenance | undefined => {
  if (isActivationProvenance(ctx?.activation)) {
    return ctx.activation;
  }
  const fromExtensions = ctx?.extensions?.[ACTIVATION_PROVENANCE_KEY];
  return isActivationProvenance(fromExtensions) ? fromExtensions : undefined;
};

export const withActivationProvenance = <
  TCtx extends {
    readonly extensions?: Readonly<Record<string, unknown>> | undefined;
  },
>(
  ctx: TCtx,
  activation: ActivationProvenance
): TCtx & { readonly activation: ActivationProvenance } => ({
  ...ctx,
  activation,
  extensions: {
    ...ctx.extensions,
    [ACTIVATION_PROVENANCE_KEY]: activation,
  },
});

export const buildActivationProvenanceTraceAttrs = (
  activation: ActivationProvenance | undefined
): Readonly<Record<string, unknown>> => {
  if (activation === undefined) {
    return {};
  }

  const attrs: Record<string, unknown> = {
    'trails.activation.fire_id': activation.fireId,
    'trails.activation.root_fire_id': activation.rootFireId,
    'trails.activation.source.id': activation.source.id,
    'trails.activation.source.kind': activation.source.kind,
  };

  if (activation.parentFireId !== undefined) {
    attrs['trails.activation.parent_fire_id'] = activation.parentFireId;
  }
  if (activation.source.producerTrailId !== undefined) {
    attrs['trails.activation.source.producer_trail.id'] =
      activation.source.producerTrailId;
  }
  if (activation.source.cron !== undefined) {
    attrs['trails.activation.source.cron'] = activation.source.cron;
  }
  if (activation.source.timezone !== undefined) {
    attrs['trails.activation.source.timezone'] = activation.source.timezone;
  }

  return attrs;
};
