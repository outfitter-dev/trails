/**
 * Deliberate fixture topo for the library projection + materialization lanes
 * (TRL-970). Small enough to read; rich enough that v0 cannot bake in
 * resource-free or happy-path-only assumptions. Each trail exercises one
 * projection path the foundation must prove.
 */
import {
  LAYER_INPUTS_KEY,
  NotFoundError,
  Result,
  resource,
  signal,
  trail,
} from '@ontrails/core';
import type { Layer } from '@ontrails/core';
import { z } from 'zod';

// --- resource with a mock factory (testAll works without configuration) ---

export interface Widget {
  readonly id: string;
  readonly name: string;
}

export interface WidgetStore {
  add(widget: Widget): void;
  get(id: string): Widget | undefined;
  list(): Widget[];
}

const defaultWidgets: readonly Widget[] = [{ id: '1', name: 'Example' }];

export const createWidgetStore = (
  seed: readonly Widget[] = defaultWidgets
): WidgetStore => {
  const store = new Map(seed.map((widget) => [widget.id, widget] as const));
  return {
    add(widget) {
      store.set(widget.id, widget);
    },
    get(id) {
      return store.get(id);
    },
    list() {
      return [...store.values()];
    },
  };
};

export const widgetStore = resource('widget.store', {
  create: () => Result.ok(createWidgetStore()),
  description: 'In-memory widget store (library fixture).',
  mock: createWidgetStore,
});

const widgetSchema = z.object({ id: z.string(), name: z.string() });

// --- stateless trail -> projects to a root named export ---

export const ping = trail('widget.ping', {
  blaze: (input) => Result.ok({ echo: input.message }),
  description: 'Stateless echo; projects to a root named export.',
  examples: [
    { expected: { echo: 'hi' }, input: { message: 'hi' }, name: 'echo' },
  ],
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ echo: z.string() }),
});

// --- domain-negative output: a failing check is a RETURNED value, not a throw ---

export const check = trail('widget.check', {
  blaze: (input) =>
    Result.ok(
      input.name.length > 0
        ? { issues: [] as string[], status: 'pass' as const }
        : { issues: ['name is empty'], status: 'fail' as const }
    ),
  description:
    'Check a widget name. A failing result is a normal returned value, never a thrown error.',
  examples: [
    {
      expected: { issues: [], status: 'pass' },
      input: { name: 'ok' },
      name: 'pass',
    },
    {
      expected: { issues: ['name is empty'], status: 'fail' },
      input: { name: '' },
      name: 'fail (returned, not thrown)',
    },
  ],
  input: z.object({ name: z.string() }),
  intent: 'read',
  output: z.object({
    issues: z.array(z.string()),
    status: z.enum(['pass', 'fail']),
  }),
});

// --- resource-bearing read + an expectErr example (maps to a root throw) ---

export const get = trail('widget.get', {
  blaze: (input, ctx) => {
    const store = widgetStore.from(ctx);
    const widget = store.get(input.id);
    if (!widget) {
      return Result.err(new NotFoundError(`Widget "${input.id}" not found`));
    }
    return Result.ok(widget);
  },
  description: 'Get a widget by id.',
  examples: [
    {
      expected: { id: '1', name: 'Example' },
      input: { id: '1' },
      name: 'found',
    },
    {
      error: 'NotFoundError',
      input: { id: 'missing' },
      name: 'not found -> throws at the root API',
    },
  ],
  input: z.object({ id: z.string() }),
  intent: 'read',
  output: widgetSchema,
  resources: [widgetStore],
});

// --- resource-bearing write + permit ---

export const add = trail('widget.add', {
  blaze: (input, ctx) => {
    const store = widgetStore.from(ctx);
    const widget = { id: input.id, name: input.name };
    store.add(widget);
    return Result.ok(widget);
  },
  description: 'Add a widget.',
  examples: [
    {
      expected: { id: '2', name: 'New' },
      input: { id: '2', name: 'New' },
      name: 'add',
    },
    {
      expectedMatch: { name: 'Matched' },
      input: { id: '3', name: 'Matched' },
      name: 'add (partial match)',
    },
  ],
  input: z.object({ id: z.string(), name: z.string() }),
  intent: 'write',
  output: widgetSchema,
  permit: { scopes: ['widget:write'] },
  resources: [widgetStore],
});

// --- versioned trail: library projects the CURRENT version only ---

export const greet = trail('widget.greet', {
  blaze: (input) => Result.ok({ message: `Hello, ${input.name}!` }),
  description:
    'Versioned greeting; the library projects the current version only.',
  examples: [
    {
      expected: { message: 'Hello, Ada!' },
      input: { name: 'Ada' },
      name: 'greet (current version)',
    },
  ],
  input: z.object({ name: z.string() }),
  intent: 'read',
  output: z.object({ message: z.string() }),
  version: 2,
  versions: {
    1: {
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      status: { state: 'archived' },
    },
  },
});

export const auditLayer: Layer = {
  input: z.object({
    message: z.string().default('default audit'),
    token: z.string().default('default token'),
  }),
  name: 'audit',
  wrap: (_trail, implementation) => async (input, ctx) =>
    await implementation(input, ctx),
};

// --- typed layer input: library projects and routes layer fields ---

export const audited = trail('widget.audited', {
  blaze: (input, ctx) => {
    const layers = ctx.extensions?.[LAYER_INPUTS_KEY] as
      | Record<string, { readonly message?: string; readonly token?: string }>
      | undefined;
    return Result.ok({
      auditMessage: layers?.['audit']?.message,
      auditToken: layers?.['audit']?.token,
      message: input.message,
    });
  },
  description:
    'Audited widget call; proves library projection includes typed layer inputs.',
  examples: [
    {
      expected: {
        auditMessage: 'default audit',
        auditToken: 'default token',
        message: 'hello',
      },
      input: { message: 'hello' },
      name: 'audited',
    },
  ],
  input: z.object({ message: z.string() }),
  intent: 'read',
  layers: [auditLayer],
  output: z.object({
    auditMessage: z.string(),
    auditToken: z.string(),
    message: z.string(),
  }),
});

// --- internal visibility: MUST be excluded from the projection ---

export const diagnose = trail('widget.diagnose', {
  blaze: () => Result.ok({ ok: true }),
  description:
    'Internal-only diagnostic; excluded from the library projection.',
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
  visibility: 'internal',
});

// --- draft id: MUST be excluded from the projection ---

export const experiment = trail('_draft.widget.experiment', {
  blaze: () => Result.ok({ todo: true }),
  description: 'Draft-authored trail; excluded from the library projection.',
  input: z.object({}),
  intent: 'read',
  output: z.object({ todo: z.boolean() }),
});

// --- signal: not a callable; should not appear as a library export ---

export const widgetAdded = signal('widget.added', {
  description: 'Fired when a widget is added.',
  payload: z.object({ id: z.string() }),
});

// --- draft AND internal: excluded, exercises reason precedence (draft wins) ---

export const secret = trail('_draft.widget.secret', {
  blaze: () => Result.ok({ secret: true }),
  description: 'Draft and internal; excluded with primary reason "draft".',
  input: z.object({}),
  intent: 'read',
  output: z.object({ secret: z.boolean() }),
  visibility: 'internal',
});

// --- activation-driven: reacts to a signal; MUST be excluded (activation) ---

export const onCreated = trail('widget.onCreated', {
  blaze: () => Result.ok({ handled: true }),
  description:
    'Reacts to widget.added; excluded from the projection (activation-driven).',
  input: z.object({ id: z.string() }),
  intent: 'read',
  on: ['widget.added'],
  output: z.object({ handled: z.boolean() }),
});
