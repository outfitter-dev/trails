/**
 * The hero surface: the switchback topo consumed as a typed in-process
 * library. Also proves the renderingPlan is collision-free and that the same
 * trail produces identical results through the library client and headless
 * execution.
 */

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';
import { deriveLibraryApi, surface } from '@ontrails/library';

import { app } from '../app.js';
import { createAuditLog } from '../resources/audit.js';
import { createMemoryFlagStore } from '../resources/flags.js';

const freshResources = () => ({
  audit: createAuditLog(),
  flags: createMemoryFlagStore(),
});

const evaluateInput = {
  context: { attributes: { plan: 'beta' }, subjectId: 'user-1' },
  key: 'checkout-v2',
};

describe('library renderingPlan', () => {
  const renderingPlan = deriveLibraryApi(app);

  test('is collision-free with no exclusions', () => {
    expect(renderingPlan.collisions).toEqual([]);
    expect(renderingPlan.excluded).toEqual([]);
  });

  test('exports every trail under a consumer-native name', () => {
    const names = renderingPlan.exports.map((entry) => entry.exportName);
    expect(names).toEqual([
      'auditList',
      'flagArchive',
      'flagCreate',
      'flagDisable',
      'flagEnable',
      'flagEvaluate',
      'flagEvaluateAll',
      'flagGet',
      'flagList',
      'flagUpdate',
      'ruleAdd',
      'ruleRemove',
      'ruleReorder',
    ]);
  });
});

describe('library client', () => {
  test('flagEvaluate returns the evaluation with its trace', async () => {
    const lib = await surface(app, { resources: freshResources() });
    const evaluation = await lib.call['flagEvaluate']?.(evaluateInput);
    expect(evaluation).toEqual({
      key: 'checkout-v2',
      reason: {
        reason: 'rule-match',
        steps: [{ outcome: 'matched', ruleId: 'beta-users' }],
      },
      value: 'treatment',
      variant: 'treatment',
    });
  });

  test('the result lane keeps the Result boundary', async () => {
    const lib = await surface(app, { resources: freshResources() });
    const missing = await lib.result['flagGet']?.({ key: 'does-not-exist' });
    expect(missing?.isErr()).toBe(true);
  });

  test('the same trail gives the same answer through headless run', async () => {
    const lib = await surface(app, { resources: freshResources() });
    const viaLibrary = await lib.call['flagEvaluate']?.(evaluateInput);
    const viaRun = await run(app, 'flag.evaluate', evaluateInput, {
      resources: freshResources(),
    });
    expect(viaRun.isOk()).toBe(true);
    if (viaRun.isOk()) {
      expect(viaLibrary).toEqual(viaRun.value);
    }
  });
});
