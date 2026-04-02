/**
 * Clack-backed input resolver for the Trails CLI.
 *
 * This stays at the app gate so @ontrails/cli remains prompt-library agnostic.
 */

import type { Field, InputResolver, ResolveInputOptions } from '@ontrails/cli';
import { isInteractive } from '@ontrails/cli';
import * as clack from '@clack/prompts';

/** Check whether a field still needs input. */
const needsInput = (field: Field, current: Record<string, unknown>): boolean =>
  current[field.name] === undefined &&
  field.required &&
  field.default === undefined;

/** Build Clack options from field options. */
const toClackOptions = (field: Field) =>
  field.options?.map((option) => ({
    ...(option.hint === undefined ? {} : { hint: option.hint }),
    label: option.label ?? option.value,
    value: option.value,
  })) ?? [];

/** Normalize cancelled prompts to `undefined`. */
const cancelable = async <T>(value: T | symbol): Promise<T | undefined> =>
  await (clack.isCancel(value) ? undefined : value);

type FieldResolver = (field: Field) => Promise<unknown>;

const fieldResolvers: Record<Field['type'], FieldResolver> = {
  boolean: async (field) =>
    cancelable(
      await clack.confirm({
        initialValue: (field.default as boolean | undefined) ?? false,
        message: field.label,
      })
    ),
  enum: async (field) =>
    cancelable(
      await clack.select({
        message: field.label,
        options: toClackOptions(field),
      })
    ),
  multiselect: async (field) =>
    cancelable(
      await clack.multiselect({
        initialValues: (field.default as string[] | undefined) ?? [],
        message: field.label,
        options: toClackOptions(field),
      })
    ),
  number: async (field) => {
    const raw = await clack.text({ message: field.label });
    return clack.isCancel(raw) ? undefined : Number(raw);
  },
  'number[]': async (field) => {
    const raw = await clack.text({
      message: `${field.label} (comma-separated numbers)`,
    });
    if (clack.isCancel(raw)) {
      return;
    }
    return String(raw)
      .split(',')
      .map((s) => Number(s.trim()));
  },
  string: async (field) =>
    cancelable(await clack.text({ message: field.label })),
  'string[]': async (field) => {
    const raw = await clack.text({
      message: `${field.label} (comma-separated)`,
    });
    if (clack.isCancel(raw)) {
      return;
    }
    return String(raw)
      .split(',')
      .map((s) => s.trim());
  },
};

/** Resolve a single field value with Clack. */
const resolveField = (field: Field): Promise<unknown> => {
  const resolver = fieldResolvers[field.type];
  return resolver(field);
};

/** Fill missing input by prompting with Clack when interactive. */
export const resolveInputWithClack: InputResolver = async (
  fields,
  provided,
  options?: ResolveInputOptions
) => {
  if (!isInteractive(options)) {
    return provided;
  }

  const resolved: Record<string, unknown> = { ...provided };
  for (const field of fields) {
    if (!needsInput(field, resolved)) {
      continue;
    }
    const value = await resolveField(field);
    if (value !== undefined) {
      resolved[field.name] = value;
    }
  }
  return resolved;
};
