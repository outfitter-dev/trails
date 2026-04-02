import { describe, expect, test } from 'bun:test';
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

import {
  destroyWithoutPermit,
  writeWithoutPermit,
  scopeNamingConsistency,
  orphanScopeDetection,
  validatePermits,
} from '../rules.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyInput = z.object({});
const noopRun = () => Result.ok({});

// ---------------------------------------------------------------------------
// destroyWithoutPermit
// ---------------------------------------------------------------------------

describe('destroyWithoutPermit', () => {
  test('error when destroy trail has no permit', () => {
    const t = trail('user.delete', {
      blaze: noopRun,
      input: emptyInput,
      intent: 'destroy',
    });
    const diagnostics = destroyWithoutPermit([t]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      message: expect.stringContaining('destroy'),
      rule: 'destroyWithoutPermit',
      severity: 'error',
      trailId: 'user.delete',
    });
  });

  test('no diagnostic when destroy trail has a scoped permit', () => {
    const t = trail('user.delete', {
      blaze: noopRun,
      input: emptyInput,
      intent: 'destroy',
      permit: { scopes: ['user:delete'] },
    });
    const diagnostics = destroyWithoutPermit([t]);
    expect(diagnostics).toHaveLength(0);
  });

  test('error when destroy trail has permit: public', () => {
    const t = trail('user.delete', {
      blaze: noopRun,
      input: emptyInput,
      intent: 'destroy',
      permit: 'public',
    });
    const diagnostics = destroyWithoutPermit([t]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      rule: 'destroyWithoutPermit',
      severity: 'error',
      trailId: 'user.delete',
    });
  });
});

// ---------------------------------------------------------------------------
// writeWithoutPermit
// ---------------------------------------------------------------------------

describe('writeWithoutPermit', () => {
  test('warning when write trail has no permit', () => {
    const t = trail('user.create', {
      blaze: noopRun,
      input: emptyInput,
    });
    const diagnostics = writeWithoutPermit([t]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      rule: 'writeWithoutPermit',
      severity: 'warning',
      trailId: 'user.create',
    });
  });

  test('no warning when write trail has permit: public', () => {
    const t = trail('user.create', {
      blaze: noopRun,
      input: emptyInput,
      permit: 'public',
    });
    const diagnostics = writeWithoutPermit([t]);
    expect(diagnostics).toHaveLength(0);
  });

  test('warning when trail has no intent (defaults to write)', () => {
    const t = trail('user.update', {
      blaze: noopRun,
      input: emptyInput,
    });
    // Override intent to undefined to simulate a manually constructed trail
    const noIntent = { ...t, intent: undefined } as unknown as ReturnType<
      typeof trail
    >;
    const diagnostics = writeWithoutPermit([noIntent]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      rule: 'writeWithoutPermit',
      severity: 'warning',
      trailId: 'user.update',
    });
  });

  test('no diagnostic for read trail without permit', () => {
    const t = trail('user.list', {
      blaze: noopRun,
      input: emptyInput,
      intent: 'read',
    });
    const diagnostics = writeWithoutPermit([t]);
    expect(diagnostics).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scopeNamingConsistency
// ---------------------------------------------------------------------------

describe('scopeNamingConsistency', () => {
  test('scope user:write passes naming check', () => {
    const t = trail('user.update', {
      blaze: noopRun,
      input: emptyInput,
      permit: { scopes: ['user:write'] },
    });
    const diagnostics = scopeNamingConsistency([t]);
    expect(diagnostics).toHaveLength(0);
  });

  test('warning for scope without colon', () => {
    const t = trail('admin.panel', {
      blaze: noopRun,
      input: emptyInput,
      permit: { scopes: ['admin'] },
    });
    const diagnostics = scopeNamingConsistency([t]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      message: expect.stringContaining('admin'),
      rule: 'scopeNamingConsistency',
      severity: 'warning',
      trailId: 'admin.panel',
    });
  });
});

// ---------------------------------------------------------------------------
// orphanScopeDetection
// ---------------------------------------------------------------------------

describe('orphanScopeDetection', () => {
  test('warning for orphan scope (typo)', () => {
    const t1 = trail('user.read', {
      blaze: noopRun,
      input: emptyInput,
      permit: { scopes: ['user:read'] },
    });
    const t2 = trail('user.write', {
      blaze: noopRun,
      input: emptyInput,
      permit: { scopes: ['user:wirte'] },
    });
    const diagnostics = orphanScopeDetection([t1, t2]);
    // Both scopes are unique (appear in only 1 trail each)
    expect(diagnostics).toHaveLength(2);
    const messages = diagnostics.map((d) => d.message);
    expect(messages.some((m) => m.includes('user:wirte'))).toBe(true);
  });

  test('no warning for shared scopes', () => {
    const t1 = trail('user.read', {
      blaze: noopRun,
      input: emptyInput,
      permit: { scopes: ['user:read'] },
    });
    const t2 = trail('user.profile', {
      blaze: noopRun,
      input: emptyInput,
      permit: { scopes: ['user:read'] },
    });
    const diagnostics = orphanScopeDetection([t1, t2]);
    expect(diagnostics).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validatePermits
// ---------------------------------------------------------------------------

/* oxlint-disable max-statements -- integration test validates all rules fire */
describe('validatePermits', () => {
  test('runs all rules and aggregates diagnostics', () => {
    const destroyNoPerm = trail('user.delete', {
      blaze: noopRun,
      input: emptyInput,
      intent: 'destroy',
    });
    const writeNoPerm = trail('user.create', {
      blaze: noopRun,
      input: emptyInput,
    });
    const badScope = trail('admin.panel', {
      blaze: noopRun,
      input: emptyInput,
      permit: { scopes: ['admin'] },
    });
    const orphanScope = trail('analytics.export', {
      blaze: noopRun,
      input: emptyInput,
      permit: { scopes: ['analytics:exportt'] },
    });

    const diagnostics = validatePermits([
      destroyNoPerm,
      writeNoPerm,
      badScope,
      orphanScope,
    ]);

    const rules = diagnostics.map((d) => d.rule);
    expect(rules).toContain('destroyWithoutPermit');
    expect(rules).toContain('writeWithoutPermit');
    expect(rules).toContain('scopeNamingConsistency');
    expect(rules).toContain('orphanScopeDetection');
    expect(diagnostics.length).toBeGreaterThanOrEqual(4);
  });
});
