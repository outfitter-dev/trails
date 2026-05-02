import { describe, expect, test } from 'bun:test';

import { readIntentFires } from '../rules/read-intent-fires.js';

const TEST_FILE = 'entity.ts';

describe('read-intent-fires', () => {
  test('warns when a read trail declares a signal-object fire', () => {
    const code = `
const entityLoaded = signal('entity.loaded', { payload: z.object({}) });

trail('entity.read', {
  intent: 'read',
  fires: [entityLoaded],
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = readIntentFires.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('read-intent-fires');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('entity.read');
    expect(diagnostics[0]?.message).toContain('entity.loaded');
    expect(diagnostics[0]?.message).toContain('fires');
    expect(diagnostics[0]?.message).toContain('ctx.fire');
  });

  test('reports multiple declared signal ids', () => {
    const code = `
const entityLoaded = signal('entity.loaded', { payload: z.object({}) });
const auditLogged = signal('audit.logged', { payload: z.object({}) });

trail('entity.read', {
  intent: 'read',
  fires: [entityLoaded, auditLogged],
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = readIntentFires.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('entity.loaded');
    expect(diagnostics[0]?.message).toContain('audit.logged');
  });

  test('warns for identifier-based fires declarations', () => {
    const code = `
const entityLoaded = signal('entity.loaded', { payload: z.object({}) });
const fires = [entityLoaded];

trail('entity.read', {
  intent: 'read',
  fires,
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = readIntentFires.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(7);
    expect(diagnostics[0]?.message).toContain('entity.loaded');
  });

  test('warns for string fires declarations', () => {
    const code = `
trail('entity.read', {
  intent: 'read',
  fires: ['entity.loaded'],
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = readIntentFires.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('entity.loaded');
  });

  test('warns for single-object trail form', () => {
    const code = `
const entityLoaded = signal('entity.loaded', { payload: z.object({}) });

trail({
  id: 'entity.read',
  intent: 'read',
  fires: [entityLoaded],
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = readIntentFires.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('entity.read');
    expect(diagnostics[0]?.message).toContain('entity.loaded');
  });

  test('warns for namespaced core.trail definitions', () => {
    const code = `
import * as core from '@ontrails/core';

const entityLoaded = core.signal('entity.loaded', { payload: z.object({}) });

core.trail('entity.read', {
  intent: 'read',
  fires: [entityLoaded],
  blaze: async () => Result.ok({}),
});
`;

    const diagnostics = readIntentFires.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('entity.loaded');
  });

  test('stays quiet for write, destroy, and unspecified intent trails', () => {
    const code = `
const entityLoaded = signal('entity.loaded', { payload: z.object({}) });

trail('entity.write', {
  intent: 'write',
  fires: [entityLoaded],
  blaze: async () => Result.ok({}),
});

trail('entity.delete', {
  intent: 'destroy',
  fires: [entityLoaded],
  blaze: async () => Result.ok({}),
});

trail('entity.default', {
  fires: [entityLoaded],
  blaze: async () => Result.ok({}),
});
`;

    expect(readIntentFires.check(code, TEST_FILE)).toEqual([]);
  });

  test('stays quiet for read trails without non-empty fires declarations', () => {
    const code = `
trail('entity.read', {
  intent: 'read',
  blaze: async () => Result.ok({}),
});

trail('entity.inspect', {
  intent: 'read',
  fires: [],
  blaze: async () => Result.ok({}),
});
`;

    expect(readIntentFires.check(code, TEST_FILE)).toEqual([]);
  });
});
