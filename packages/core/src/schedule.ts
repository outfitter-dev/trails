import { ValidationError } from './errors.js';
import type {
  ActivationSource,
  ActivationSourceMeta,
} from './activation-source.js';

type ScheduleInputDefault = Record<string, never>;

export interface ScheduleSpec<TInput = unknown> {
  readonly cron: string;
  readonly input?: TInput | undefined;
  readonly meta?: ActivationSourceMeta | undefined;
  readonly timezone?: string | undefined;
}

export interface ScheduleSource<TInput = unknown> extends ActivationSource {
  readonly cron: string;
  readonly input: TInput;
  readonly kind: 'schedule';
  readonly meta?: ActivationSourceMeta | undefined;
  readonly timezone?: string | undefined;
}

export interface ScheduleValidationIssue {
  readonly field: 'cron' | 'input' | 'timezone';
  readonly message: string;
}

const CRON_FIELD_BOUNDS = Object.freeze([
  { max: 59, min: 0, name: 'minute' },
  { max: 23, min: 0, name: 'hour' },
  { max: 31, min: 1, name: 'day of month' },
  { max: 12, min: 1, name: 'month' },
  { max: 7, min: 0, name: 'day of week' },
] as const);

const EMPTY_INPUT = Object.freeze({}) as ScheduleInputDefault;

const normalizeCron = (cron: string): string =>
  cron.trim().replaceAll(/\s+/g, ' ');

const isIntegerToken = (value: string): boolean => /^\d+$/.test(value);

const parseIntegerToken = (value: string): number | undefined =>
  isIntegerToken(value) ? Number.parseInt(value, 10) : undefined;

const isNumberInRange = (
  value: string,
  bounds: (typeof CRON_FIELD_BOUNDS)[number]
): boolean => {
  const parsed = parseIntegerToken(value);
  return parsed !== undefined && parsed >= bounds.min && parsed <= bounds.max;
};

const isCronAtomValid = (
  atom: string,
  bounds: (typeof CRON_FIELD_BOUNDS)[number]
): boolean => {
  if (atom === '*') {
    return true;
  }
  if (isNumberInRange(atom, bounds)) {
    return true;
  }

  const range = atom.split('-');
  if (range.length !== 2) {
    return false;
  }
  const [rangeStart, rangeEnd] = range;
  if (rangeStart === undefined || rangeEnd === undefined) {
    return false;
  }
  if (
    !isNumberInRange(rangeStart, bounds) ||
    !isNumberInRange(rangeEnd, bounds)
  ) {
    return false;
  }
  const start = Number.parseInt(rangeStart, 10);
  const end = Number.parseInt(rangeEnd, 10);
  return start <= end;
};

const isCronPartValid = (
  part: string,
  bounds: (typeof CRON_FIELD_BOUNDS)[number]
): boolean => {
  const stepped = part.split('/');
  if (stepped.length > 2) {
    return false;
  }
  const [atom, step] = stepped;
  if (!atom || !isCronAtomValid(atom, bounds)) {
    return false;
  }
  if (step === undefined) {
    return true;
  }
  const parsedStep = parseIntegerToken(step);
  return parsedStep !== undefined && parsedStep > 0;
};

const validateCronField = (
  field: string,
  bounds: (typeof CRON_FIELD_BOUNDS)[number]
): string | undefined => {
  if (field.length === 0) {
    return `${bounds.name} field is empty`;
  }
  const parts = field.split(',');
  return parts.every((part) => isCronPartValid(part, bounds))
    ? undefined
    : `${bounds.name} field is not a supported cron expression`;
};

const validateCron = (cron: unknown): ScheduleValidationIssue[] => {
  if (typeof cron !== 'string' || cron.trim().length === 0) {
    return [
      { field: 'cron', message: 'Cron expression must be a non-empty string' },
    ];
  }

  const normalized = normalizeCron(cron);
  const fields = normalized.split(' ');
  if (fields.length !== CRON_FIELD_BOUNDS.length) {
    return [
      {
        field: 'cron',
        message: 'Cron expression must contain exactly five fields',
      },
    ];
  }

  return fields.flatMap((field, index) => {
    const bounds = CRON_FIELD_BOUNDS[index];
    if (!bounds) {
      return [];
    }
    const issue = validateCronField(field, bounds);
    return issue === undefined
      ? []
      : [{ field: 'cron' as const, message: issue }];
  });
};

const isTimezoneValid = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

const validateTimezone = (
  timezone: unknown
): readonly ScheduleValidationIssue[] => {
  if (timezone === undefined) {
    return [];
  }
  if (typeof timezone !== 'string' || timezone.trim().length === 0) {
    return [
      {
        field: 'timezone',
        message: 'Timezone must be a non-empty IANA timezone string',
      },
    ];
  }
  return isTimezoneValid(timezone.trim())
    ? []
    : [
        {
          field: 'timezone',
          message: `Timezone "${timezone}" is not supported by Intl.DateTimeFormat`,
        },
      ];
};

const isNonJsonLeaf = (value: unknown): boolean => {
  if (value === undefined) {
    return true;
  }
  const kind = typeof value;
  if (kind === 'function' || kind === 'symbol' || kind === 'bigint') {
    return true;
  }
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set
  );
};

const containsNonSerializableLeaf = (
  value: unknown,
  seen: WeakSet<object>
): boolean => {
  if (isNonJsonLeaf(value)) {
    return true;
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => containsNonSerializableLeaf(entry, seen));
  }
  return Object.values(value).some((entry) =>
    containsNonSerializableLeaf(entry, seen)
  );
};

const validateInput = (input: unknown): readonly ScheduleValidationIssue[] => {
  if (containsNonSerializableLeaf(input, new WeakSet<object>())) {
    return [
      {
        field: 'input',
        message: 'Schedule input must be JSON-serializable data',
      },
    ];
  }
  try {
    JSON.stringify(input);
    return [];
  } catch {
    return [
      {
        field: 'input',
        message: 'Schedule input must be JSON-serializable data',
      },
    ];
  }
};

const scheduleIssuesMessage = (
  id: string,
  issues: readonly ScheduleValidationIssue[]
): string =>
  `schedule("${id}") is invalid: ${issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')}`;

const assertScheduleSpec = (
  id: string,
  spec: ScheduleSpec
): {
  readonly cron: string;
  readonly input: unknown;
  readonly timezone?: string | undefined;
} => {
  const input = spec.input === undefined ? EMPTY_INPUT : spec.input;
  const timezone = spec.timezone?.trim();
  const issues = [
    ...validateCron(spec.cron),
    ...validateTimezone(timezone),
    ...validateInput(input),
  ];

  if (issues.length > 0) {
    throw new ValidationError(scheduleIssuesMessage(id, issues), {
      context: { issues },
    });
  }

  return {
    cron: normalizeCron(spec.cron),
    input,
    ...(timezone === undefined ? {} : { timezone }),
  };
};

export const validateScheduleSource = (
  source: ActivationSource
): readonly ScheduleValidationIssue[] => {
  if (source.kind !== 'schedule') {
    return [];
  }
  const input = Object.hasOwn(source, 'input') ? source.input : EMPTY_INPUT;
  return [
    ...validateCron(source.cron),
    ...validateTimezone(source.timezone),
    ...validateInput(input),
  ];
};

export function schedule<TInput>(
  id: string,
  spec: ScheduleSpec<TInput> & { readonly input: TInput }
): ScheduleSource<TInput>;
export function schedule(
  id: string,
  spec: ScheduleSpec
): ScheduleSource<ScheduleInputDefault>;
export function schedule<TInput>(
  spec: ScheduleSpec<TInput> & { readonly id: string; readonly input: TInput }
): ScheduleSource<TInput>;
export function schedule(
  spec: ScheduleSpec & { readonly id: string }
): ScheduleSource<ScheduleInputDefault>;
export function schedule<TInput>(
  idOrSpec: string | (ScheduleSpec<TInput> & { readonly id: string }),
  maybeSpec?: ScheduleSpec<TInput>
): ScheduleSource<TInput | ScheduleInputDefault> {
  const id = typeof idOrSpec === 'string' ? idOrSpec : idOrSpec.id;
  // oxlint-disable-next-line no-non-null-assertion -- overload guarantees maybeSpec when idOrSpec is string
  const spec = typeof idOrSpec === 'string' ? maybeSpec! : idOrSpec;
  const normalized = assertScheduleSpec(id, spec);

  return Object.freeze({
    cron: normalized.cron,
    id,
    input: normalized.input as TInput | ScheduleInputDefault,
    kind: 'schedule' as const,
    ...(spec.meta === undefined
      ? {}
      : { meta: Object.freeze({ ...spec.meta }) }),
    ...(normalized.timezone === undefined
      ? {}
      : { timezone: normalized.timezone }),
  });
}
