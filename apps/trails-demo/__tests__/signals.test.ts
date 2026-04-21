/**
 * End-to-end integration tests for the producer -> consumer signal flow.
 *
 * Proves that `fires:` / `on:` fan-out works against a real topo:
 * - entity.add declares `fires: ['entity.updated']` and calls ctx.fire
 * - entity.updated is a signal defined in src/signals/entity-signals.ts
 * - entity.notify-updated declares `on: ['entity.updated']` as a consumer
 *   and reads its notification sink from a real resource registered on
 *   the producer's context — proving consumer ctx inheritance (TRL-198)
 *
 * Also exercises the warden rules that guard the declarations.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';
import type { RuleOutput } from '@ontrails/warden';
import {
  firesDeclarationsTrail,
  onReferencesExistTrail,
  wardenTopo,
} from '@ontrails/warden';

import { graph } from '../src/app.js';
import { entityStoreResource } from '../src/resources/entity-store.js';
import {
  createNotificationStore,
  notificationStoreResource,
} from '../src/resources/notification-store.js';
import { createStore } from '../src/store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const moduleDir = dirname(fileURLToPath(import.meta.url));
const entitySourcePath = resolve(moduleDir, '../src/trails/entity.ts');
const notifySourcePath = resolve(moduleDir, '../src/trails/notify.ts');

const buildCtxExtensions = (
  entityStore: ReturnType<typeof createStore>,
  notificationStore: ReturnType<typeof createNotificationStore>
) => ({
  [entityStoreResource.id]: entityStore,
  [notificationStoreResource.id]: notificationStore,
});

// ---------------------------------------------------------------------------
// End-to-end fan-out
// ---------------------------------------------------------------------------

describe('entity.updated signal flow', () => {
  test('entity.add fires entity.updated and notify consumer runs', async () => {
    const entityStore = createStore([]);
    const notificationStore = createNotificationStore();
    const result = await run(
      graph,
      'entity.add',
      { name: 'Epsilon', tags: ['reactive'], type: 'concept' },
      {
        ctx: { extensions: buildCtxExtensions(entityStore, notificationStore) },
      }
    );
    expect(result.isOk()).toBe(true);
    const notifications = notificationStore.list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.action).toBe('created');
    expect(notifications[0]?.entityName).toBe('Epsilon');
    expect(notifications[0]?.entityId).toBeString();
    expect(notifications[0]?.timestamp).toBeString();
  });

  test('entity.delete also fires entity.updated', async () => {
    const entityStore = createStore([
      { name: 'Disposable', tags: [], type: 'tool' },
    ]);
    const notificationStore = createNotificationStore();
    const result = await run(
      graph,
      'entity.delete',
      { name: 'Disposable' },
      {
        ctx: { extensions: buildCtxExtensions(entityStore, notificationStore) },
      }
    );
    expect(result.isOk()).toBe(true);
    const notifications = notificationStore.list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.action).toBe('deleted');
    expect(notifications[0]?.entityName).toBe('Disposable');
    // entityId should be the store-generated id, not the natural key.
    expect(notifications[0]?.entityId).toBeString();
    expect(notifications[0]?.entityId).not.toBe('Disposable');
  });
});

// ---------------------------------------------------------------------------
// Topo registration sanity
// ---------------------------------------------------------------------------

describe('signal wiring in the demo topo', () => {
  test('entity.updated is registered as a signal', () => {
    expect(graph.signals.has('entity.updated')).toBe(true);
  });

  test('entity.notify-updated is registered with on: [entity.updated]', () => {
    const consumer = graph.get('entity.notify-updated');
    expect(consumer).toBeDefined();
    expect(consumer?.on).toContain('entity.updated');
  });

  test('entity.add declares fires: [entity.updated]', () => {
    const producer = graph.get('entity.add');
    expect(producer).toBeDefined();
    expect(producer?.fires).toContain('entity.updated');
  });
});

// ---------------------------------------------------------------------------
// Warden rule coverage
// ---------------------------------------------------------------------------

describe('warden rules over the signal producer/consumer', () => {
  test('fires-declarations passes for entity.ts', async () => {
    const source = readFileSync(entitySourcePath, 'utf8');
    const result = await run(wardenTopo, firesDeclarationsTrail.id, {
      filePath: entitySourcePath,
      sourceCode: source,
    });
    const output = result.unwrap() as RuleOutput;
    expect(output.diagnostics).toEqual([]);
  });

  test('on-references-exist passes for notify.ts with known signals', async () => {
    const source = readFileSync(notifySourcePath, 'utf8');
    const result = await run(wardenTopo, onReferencesExistTrail.id, {
      filePath: notifySourcePath,
      knownSignalIds: ['entity.updated'],
      knownTrailIds: [],
      sourceCode: source,
    });
    const output = result.unwrap() as RuleOutput;
    expect(output.diagnostics).toEqual([]);
  });
});
