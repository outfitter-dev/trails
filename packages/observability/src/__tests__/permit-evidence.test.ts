import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureSubsystemSchema, executeTrail } from '@ontrails/core';
import type { TraceRecord } from '@ontrails/core';

import { createDevStore } from '../dev/store.js';
import { DEFAULT_SAMPLING } from '../dev/sampling.js';
import { tracingResource } from '../dev/tracing-resource.js';
import { tracingQuery } from '../dev/trails/tracing-query.js';
import { createOtelAdapter } from '../otel.js';
import type { OtelSpan } from '../otel.js';

const dirs: string[] = [];
const temporaryPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'permit-evidence-'));
  dirs.push(dir);
  return join(dir, 'traces.sqlite');
};
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const evidence = {
  actors: [
    {
      id: 'current',
      issuer: 'https://actor.example',
      kind: 'agent',
      verified: true,
    },
    { id: 'asserted-prior', kind: 'unknown', verified: false },
  ],
  id: 'subject',
  issuer: 'https://attester.example',
  tenantId: 'tenant',
};
const record = (id: string, permit: TraceRecord['permit']): TraceRecord => ({
  attrs: { retained: true },
  id,
  kind: 'trail',
  name: 'entry',
  permit,
  rootId: 'root',
  startedAt: Date.now(),
  status: 'ok',
  traceId: 'trace',
});

// The actual v2 layout is fixed here so the retention test cannot regenerate it
// from the new schema and accidentally skip a destructive upgrade.
const LEGACY_TABLE = `CREATE TABLE track_records (
  id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, root_id TEXT NOT NULL, parent_id TEXT,
  kind TEXT NOT NULL, name TEXT NOT NULL, trail_id TEXT, surface TEXT, intent TEXT,
  started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL, error_category TEXT,
  permit_id TEXT, permit_tenant_id TEXT, attrs TEXT
)`;

describe('stored permit evidence', () => {
  test('round trips the complete ordered actor chain and attester on a fresh store', () => {
    const path = temporaryPath();
    let store = createDevStore({ path });
    store.write(record('current', evidence));
    store.close();
    store = createDevStore({ path });
    try {
      expect(store.query()[0]?.permit).toEqual(evidence);
    } finally {
      store.close();
    }
  });

  test('upgrades existing version2 rows without deletion or inventing empty historical actors', () => {
    const path = temporaryPath();
    const legacy = new Database(path);
    ensureSubsystemSchema(legacy, {
      migrate: () => {
        legacy.run(LEGACY_TABLE);
      },
      subsystem: 'track',
      version: 2,
    });
    legacy.run(
      'INSERT INTO track_records (id,trace_id,root_id,kind,name,started_at,status,permit_id,permit_tenant_id,attrs) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        'legacy',
        'trace',
        'root',
        'trail',
        'old-entry',
        Date.now(),
        'ok',
        'old-subject',
        'old-tenant',
        JSON.stringify({ original: true }),
      ]
    );
    legacy.close();
    let store = createDevStore({ path });
    try {
      const old = store.query().find((value) => value.id === 'legacy');
      expect(old?.permit).toEqual({
        id: 'old-subject',
        tenantId: 'old-tenant',
      });
      expect(old?.attrs).toEqual({ original: true });
      store.write(record('known-empty', { actors: [], id: 'new-subject' }));
    } finally {
      store.close();
    }
    store = createDevStore({ path });
    try {
      expect(store.count()).toBe(2);
      expect(
        store.query().find((value) => value.id === 'legacy')?.permit?.actors
      ).toBeUndefined();
      expect(
        store.query().find((value) => value.id === 'known-empty')?.permit
          ?.actors
      ).toEqual([]);
    } finally {
      store.close();
    }
  });
  test('preserves identity through the public trace query schema', async () => {
    const store = createDevStore({ path: temporaryPath() });
    try {
      store.write(record('query', evidence));
      const result = await executeTrail(
        tracingQuery,
        {},
        {
          resources: {
            [tracingResource.id]: {
              active: true,
              sampling: DEFAULT_SAMPLING,
              store,
            },
          },
        }
      );
      expect(result.unwrap().records[0]?.permit).toEqual(evidence);
    } finally {
      store.close();
    }
  });

  test('exports the complete ordered actor chain and protects stable identity attributes', async () => {
    const spans: OtelSpan[] = [];
    const adapter = createOtelAdapter({
      exporter: (exported) => {
        spans.push(...exported);
      },
    });
    await adapter.write({
      ...record('export', evidence),
      attrs: {
        'trails.permit.actors': 'spoof',
        'trails.permit.issuer': 'spoof',
      },
    });
    const attributes = spans[0]?.attributes;
    expect(attributes?.['trails.permit.issuer']).toBe(evidence.issuer);
    const encoded = attributes?.['trails.permit.actors'];
    expect(encoded).toBeTypeOf('string');
    if (typeof encoded === 'string') {
      expect(JSON.parse(encoded)).toEqual(evidence.actors);
    }
    await adapter.write(record('legacy-export', { id: 'legacy' }));
    expect(spans[1]?.attributes['trails.permit.actors']).toBeUndefined();
  });

  test('rejects corrupt persisted actor JSON instead of relabeling it as empty', () => {
    for (const raw of ['not-json', '{}', 'null']) {
      const path = temporaryPath();
      const initial = createDevStore({ path });
      initial.write(record('corrupt', evidence));
      initial.close();
      const db = new Database(path);
      db.run('UPDATE track_records SET permit_actors = ? WHERE id = ?', [
        raw,
        'corrupt',
      ]);
      db.close();
      const store = createDevStore({ path });
      try {
        expect(() => store.query()).toThrow();
      } finally {
        store.close();
      }
    }
  });
});
