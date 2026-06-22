import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import {
  ConflictError,
  DETOUR_MAX_ATTEMPTS_CAP,
  Result,
  SURFACE_LAYER_NAMES_KEY,
  contour,
  openReadTrailsDb,
  resource,
  schedule,
  signal,
  topo,
  trail,
  webhook,
} from '@ontrails/core';
import type { TrailSpec } from '@ontrails/core';
import { deriveCliCommands } from '@ontrails/cli';
import {
  deriveTopoGraph,
  deriveTopoGraphHash,
  deriveTopoGraphDiff,
  stripTopoGraphForces,
  TOPO_GRAPH_SCHEMA_VERSION,
  writeTopoGraph,
} from '@ontrails/topographer';
import type { TopoGraph } from '@ontrails/topographer';
import { loadWayfinderArtifacts } from '@ontrails/wayfinder';
import { z } from 'zod';

import {
  deriveBriefReport,
  deriveShippedSurfaceProjectionInventory,
  deriveSignalDetail,
  deriveSurveyList,
  deriveTrailDetail,
  surveyBriefTrail,
  surveyDiffTrail,
  surveyResourceTrail,
  surveySignalTrail,
  surveySurfacesTrail,
  surveyTrail,
  surveyTrailDetailTrail,
} from '../trails/survey.js';
import { loadApp } from '../trails/load-app.js';
import {
  buildCurrentTopoMatches,
  buildCurrentTrailDetail,
  readSurfaceLayerNamesFromContext,
} from '../trails/topo-read-support.js';
import {
  shippedSurfaceInventoryOutput,
  surfaceProjectionOutput,
  trailDetailOutput,
} from '../trails/topo-output-schemas.js';
import { compileTrail } from '../trails/compile.js';
import { validateTrail } from '../trails/validate.js';
import type {
  BriefReport,
  ShippedSurfaceInventoryReport,
  SignalDetailReport,
  SurveyListReport,
  TrailDetailReport,
} from '../trails/survey.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const helloTrail = trail('hello', {
  blaze: (input) => {
    const name = input.name ?? 'world';
    return Result.ok({ message: `Hello, ${name}!` });
  },
  description: 'Say hello',
  detours: [
    {
      on: ConflictError,
      /* oxlint-disable-next-line require-await -- test stub */
      recover: async () => Result.ok({ message: 'recovered' }),
    },
  ],
  examples: [
    {
      expected: { message: 'Hello, world!' },
      input: {},
      name: 'Default greeting',
    },
  ],
  input: z.object({ name: z.string().optional() }),
  intent: 'read',
  output: z.object({ message: z.string() }),
  resources: [
    resource('db.main', {
      create: () => Result.ok({ source: 'factory' }),
    }),
  ],
});

const byeTrail = trail('bye', {
  blaze: (input) => Result.ok({ message: `Goodbye, ${input.name}!` }),
  description: 'Say goodbye',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
});

const [dbResource] = helloTrail.resources;
if (!dbResource) {
  throw new Error('Expected helloTrail to declare db.main');
}

const app = topo('test-app', {
  bye: byeTrail,
  dbResource,
  hello: helloTrail,
});

const helloGreeted = signal('hello.greeted', {
  description: 'A greeting was produced',
  examples: [{ name: 'Ada' }],
  from: ['signal.producer'],
  payload: z.object({ name: z.string() }),
});

const signalProducer = trail('signal.producer', {
  blaze: (input) => Result.ok({ name: input.name }),
  fires: [helloGreeted],
  input: z.object({ name: z.string() }),
  output: z.object({ name: z.string() }),
});

const signalConsumer = trail('signal.consumer', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  on: [helloGreeted],
  output: z.object({ ok: z.boolean() }),
});

const signalApp = topo('signal-app', {
  helloGreeted,
  signalConsumer,
  signalProducer,
});

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const countTopoSnapshots = (rootDir: string): number => {
  const db = openReadTrailsDb({ rootDir });
  try {
    return (
      db
        .query<{ count: number }, []>(
          'SELECT COUNT(*) as count FROM topo_snapshots'
        )
        .get()?.count ?? 0
    );
  } finally {
    db.close();
  }
};

const writeSurveyAppFixture = (
  dir: string,
  options?: { readonly helloNameRequired?: boolean; readonly withBye?: boolean }
) => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  const byeSource = options?.withBye
    ? `
const bye = trail('bye', {
  blaze: async (input) => Result.ok({ message: \`Bye, \${input.name ?? 'world'}!\` }),
  input: z.object({ name: z.string().optional() }),
  intent: 'read',
  output: z.object({ message: z.string() }),
});
`
    : '';
  const topoMembers = options?.withBye
    ? '{ bye, dbMain, hello }'
    : '{ dbMain, hello }';
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, resource, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const hello = trail('hello', {
  blaze: async (input) => Result.ok({ message: \`Hello, \${input.name ?? 'world'}!\` }),
  input: z.object({ name: z.string()${options?.helloNameRequired ? '' : '.optional()'} }),
  intent: 'read',
  output: z.object({ message: z.string() }),
  resources: [
    resource('db.main', {
      create: () => Result.ok({ source: 'factory' }),
    }),
  ],
});

const [dbMain] = hello.resources;
if (!dbMain) {
  throw new Error('expected hello to declare db.main');
}

${byeSource}

export const app = topo('survey-fixture', ${topoMembers});
`
  );
};

const writeVersionedDiffAppFixture = (
  dir: string,
  options?: {
    readonly archiveV1?: boolean;
    readonly deprecateV1?: boolean;
    readonly deprecateV2?: boolean;
    readonly omitV1?: boolean;
  }
) => {
  const versionOneSource = options?.omitV1
    ? ''
    : `    1: {
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      ${options?.archiveV1 ? "status: { reason: 'No callers remain.', state: 'archived' }," : ''}
      ${options?.deprecateV1 ? "status: { migration: ['Use v3.'], state: 'deprecated' }," : ''}
    },
`;
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const versioned = trail('versioned', {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  version: 3,
  versions: {
${versionOneSource}\
    2: {
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      ${options?.deprecateV2 ? "status: { migration: ['Use v3.'], state: 'deprecated' }," : ''}
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
    },
  },
});

export const app = topo('versioned-diff-fixture', { versioned });
`
  );
};

const writeMultiMatchAppFixture = (dir: string) => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, resource, signal, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const sharedResource = resource('shared', {
  create: () => Result.ok({ source: 'factory' }),
});

const sharedSignal = signal('shared', {
  payload: z.object({ ok: z.boolean() }),
});

const sharedTrail = trail('shared', {
  blaze: async () => Result.ok({ ok: true }),
  fires: [sharedSignal],
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
  resources: [sharedResource],
});

export const app = topo('multi-match-fixture', {
  sharedResource,
  sharedSignal,
  sharedTrail,
});
`
  );
};

const repoTempDir = (): string =>
  join(
    resolve(import.meta.dir, '../..'),
    '.tmp-tests',
    `trails-survey-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

let testStateHome: string | undefined;
let originalTrailsStateHome: string | undefined;

beforeEach(() => {
  originalTrailsStateHome = process.env.TRAILS_STATE_HOME;
  testStateHome = repoTempDir();
  process.env.TRAILS_STATE_HOME = testStateHome;
});

afterEach(() => {
  if (originalTrailsStateHome === undefined) {
    delete process.env.TRAILS_STATE_HOME;
  } else {
    process.env.TRAILS_STATE_HOME = originalTrailsStateHome;
  }
  if (testStateHome !== undefined) {
    rmSync(testStateHome, { force: true, recursive: true });
    testStateHome = undefined;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trails survey', () => {
  test('deriveTopoGraph includes all trails', () => {
    const surfaceMap = deriveTopoGraph(app);
    expect(surfaceMap.entries.length).toBe(3);
    const ids = surfaceMap.entries.map((e) => e.id);
    expect(ids).toContain('hello');
    expect(ids).toContain('bye');
    expect(ids).toContain('db.main');
  });

  test('TopoGraph entries have expected fields', () => {
    const surfaceMap = deriveTopoGraph(app);
    const hello = surfaceMap.entries.find((e) => e.id === 'hello');
    expect(hello).toBeDefined();
    expect(hello?.cli?.path).toEqual(['hello']);
    expect(hello?.kind).toBe('trail');
    expect(hello?.intent).toBe('read');
    expect(hello?.exampleCount).toBe(1);
    expect(hello?.resources).toEqual(['db.main']);
  });

  test('JSON output is valid JSON', () => {
    const surfaceMap = deriveTopoGraph(app);
    const json = JSON.stringify(surfaceMap, null, 2);
    const parsed = JSON.parse(json) as TopoGraph;
    expect(parsed.topoGraphSchemaVersion).toBe(TOPO_GRAPH_SCHEMA_VERSION);
    expect(parsed.entries.length).toBe(3);
  });

  test('deriveTopoGraphHash produces stable hash', () => {
    const surfaceMap = deriveTopoGraph(app);
    const hash1 = deriveTopoGraphHash(surfaceMap);
    const hash2 = deriveTopoGraphHash(surfaceMap);
    expect(hash1).toBe(hash2);
    // SHA-256 hex
    expect(hash1.length).toBe(64);
  });

  test('deriveTopoGraphDiff detects added trails', () => {
    const prev = deriveTopoGraph(
      topo('test', { dbResource, hello: helloTrail })
    );
    const curr = deriveTopoGraph(app);
    const diff = deriveTopoGraphDiff(prev, curr);

    expect(diff.info.length).toBeGreaterThan(0);
    const addedBye = diff.info.find((e) => e.id === 'bye');
    expect(addedBye).toBeDefined();
    expect(addedBye?.change).toBe('added');
  });

  test('deriveTopoGraphDiff detects removed trails', () => {
    const prev = deriveTopoGraph(app);
    const curr = deriveTopoGraph(
      topo('test', { dbResource, hello: helloTrail })
    );
    const diff = deriveTopoGraphDiff(prev, curr);

    expect(diff.hasBreaking).toBe(true);
    const removedBye = diff.breaking.find((e) => e.id === 'bye');
    expect(removedBye).toBeDefined();
    expect(removedBye?.change).toBe('removed');
  });

  test('deriveTopoGraphDiff returns empty for identical maps', () => {
    const surfaceMap = deriveTopoGraph(app);
    const diff = deriveTopoGraphDiff(surfaceMap, surfaceMap);
    expect(diff.entries.length).toBe(0);
    expect(diff.hasBreaking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Brief mode (formerly scout)
// ---------------------------------------------------------------------------

describe('trails survey brief', () => {
  test('produces a valid capability report', () => {
    const report = deriveBriefReport(app);
    expect(report.name).toBe('test-app');
    expect(report.contractVersion).toBe('2026-03');
  });

  test('report includes correct trail count', () => {
    const report = deriveBriefReport(app);
    expect(report.trails).toBe(2);
    expect(report.signals).toBe(0);
    expect(report.resources).toBe(1);
  });

  test('detects features in use', () => {
    const report = deriveBriefReport(app);
    expect(report.features.outputSchemas).toBe(true);
    expect(report.features.examples).toBe(true);
    expect(report.features.detours).toBe(true);
    expect(report.features.signals).toBe(false);
    expect(report.features.resources).toBe(true);
  });

  test('detects and counts live version-entry examples', () => {
    const versioned = trail('brief.versioned', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ name: z.string() }),
      output: z.object({ ok: z.boolean() }),
      version: 3,
      versions: {
        1: {
          examples: [
            {
              expected: { ok: true },
              input: { name: 'legacy' },
              name: 'Legacy brief example',
            },
          ],
          input: z.object({ name: z.string() }),
          output: z.object({ ok: z.boolean() }),
          status: { note: 'Use the current version.', state: 'deprecated' },
        },
        2: {
          examples: [
            {
              expected: { ok: true },
              input: { name: 'archived' },
              name: 'Archived brief example',
            },
          ],
          input: z.object({ name: z.string() }),
          output: z.object({ ok: z.boolean() }),
          status: { state: 'archived' },
        },
      },
    });
    const versionedApp = topo('brief-versioned-app', { versioned });

    expect(deriveBriefReport(versionedApp).features.examples).toBe(true);
    expect(deriveSurveyList(versionedApp).entries).toEqual([
      expect.objectContaining({ examples: 1, id: 'brief.versioned' }),
    ]);
  });

  test('JSON output is valid', () => {
    const report = deriveBriefReport(app);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json) as BriefReport;
    expect(parsed.name).toBe('test-app');
    expect(parsed.trails).toBe(2);
    expect(parsed.resources).toBe(1);
  });

  test('empty app reports zero features', () => {
    const emptyApp = topo('empty', {});
    const report = deriveBriefReport(emptyApp);
    expect(report.trails).toBe(0);
    expect(report.features.outputSchemas).toBe(false);
    expect(report.features.examples).toBe(false);
    expect(report.features.detours).toBe(false);
    expect(report.features.resources).toBe(false);
  });

  test('survey.brief returns the brief report directly', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const report = expectOk(
        await surveyBriefTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as BriefReport;

      expect(report).toMatchObject({
        name: 'survey-fixture',
        resources: 1,
        trails: 1,
      });
      expect('mode' in report).toBe(false);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('survey.surfaces returns the shipped projection inventory directly', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const report = expectOk(
        await surveySurfacesTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as ShippedSurfaceInventoryReport;

      expect(report).toMatchObject({
        count: 1,
        shippedSurfaces: ['cli', 'mcp', 'http'],
      });
      expect(report.projections).toHaveLength(3);
      expect(shippedSurfaceInventoryOutput.safeParse(report).success).toBe(
        true
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('trails survey detail', () => {
  test('trail detail includes declared resources, compositions, and intent', () => {
    const detail = deriveTrailDetail(helloTrail);
    const parsed = structuredClone(detail) as TrailDetailReport;

    expect(parsed.activatedBy).toEqual([]);
    expect(parsed.activates).toEqual([]);
    expect(parsed.activationChains).toEqual([]);
    expect(parsed.activationEdges).toEqual([]);
    expect(parsed.activationSources).toEqual([]);
    expect(parsed.composes).toEqual([]);
    expect(parsed.fires).toEqual([]);
    expect(parsed.intent).toBe('read');
    expect(parsed.on).toEqual([]);
    expect(parsed.resources).toEqual(['db.main']);
    expect(parsed.composedLayers).toEqual({
      surface: { cli: [], http: [], mcp: [] },
      topo: [],
      trail: [],
    });
  });

  test('trail detail reports version-entry example coverage', () => {
    const versioned = trail('survey.versioned', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
      version: 2,
      versions: {
        1: {
          examples: [
            {
              expected: { ok: true },
              input: { legacyId: 'old' },
              name: 'Legacy survey example',
            },
          ],
          input: z.object({ legacyId: z.string() }),
          output: z.object({ ok: z.boolean() }),
          status: { note: 'Use the current version.', state: 'deprecated' },
          transpose: {
            input: ({ input }) => ({ id: input.legacyId }),
            output: ({ output }) => output,
          },
        },
      },
    });
    const detail = structuredClone(
      deriveTrailDetail(versioned, topo('version-survey-app', { versioned }))
    ) as TrailDetailReport;

    expect(detail.version).toBe(2);
    expect(detail.supports).toEqual([1, 2]);
    expect(detail.versions['1']).toMatchObject({
      exampleCount: 1,
      examples: [
        expect.objectContaining({
          name: 'Legacy survey example',
          provenance: { source: 'trail.versions.examples' },
        }),
      ],
      kind: 'revision',
      status: { note: 'Use the current version.', state: 'deprecated' },
    });
    expect(trailDetailOutput.safeParse(detail).success).toBe(true);
  });

  test('trail detail surfaces composed layers from every scope', () => {
    const trailLayer = {
      name: 'trail-A',
      wrap: (_t: unknown, impl: unknown) => impl as never,
    };
    const topoLayer = {
      name: 'topo-Z',
      wrap: (_t: unknown, impl: unknown) => impl as never,
    };
    const layered = trail('layered.surveyed', {
      blaze: () => Result.ok({}),
      input: z.object({}),
      layers: [trailLayer],
    });
    const layeredApp = topo(
      'layered-app',
      { layered },
      { layers: [topoLayer] }
    );

    const parsed = structuredClone(
      deriveTrailDetail(layered, layeredApp, undefined, {
        surfaceLayerNames: { cli: ['cli-B'] },
      })
    ) as TrailDetailReport;

    expect(parsed.composedLayers.trail).toEqual(['trail-A']);
    expect(parsed.composedLayers.topo).toEqual(['topo-Z']);
    expect(parsed.composedLayers.surface).toEqual({
      cli: ['cli-B'],
      http: [],
      mcp: [],
    });
  });

  test('current topo read support forwards surface layer names', () => {
    const layer = {
      name: 'trail-A',
      wrap: (_t: unknown, impl: unknown) => impl as never,
    };
    const layered = trail('layered.current', {
      blaze: () => Result.ok({}),
      input: z.object({}),
      layers: [layer],
    });
    const layeredApp = topo('layered-app', { layered });

    const detail = buildCurrentTrailDetail(layeredApp, layered.id, {
      surfaceLayerNames: { cli: ['cli-B'], http: ['http-C'] },
    });
    const matches = buildCurrentTopoMatches(layeredApp, layered.id, {
      surfaceLayerNames: { mcp: ['mcp-D'] },
    });

    expect(detail?.composedLayers.surface).toEqual({
      cli: ['cli-B'],
      http: ['http-C'],
      mcp: [],
    });
    expect(matches[0]?.detail.kind).toBe('trail');
    expect(
      matches[0]?.detail.kind === 'trail'
        ? matches[0].detail.composedLayers.surface
        : undefined
    ).toEqual({
      cli: [],
      http: [],
      mcp: ['mcp-D'],
    });
  });

  test('surface layer names tolerate explicit undefined values', () => {
    const parsed = structuredClone(
      deriveTrailDetail(helloTrail, undefined, undefined, {
        surfaceLayerNames: {
          cli: undefined,
          mcp: ['mcp-A'],
        } as Partial<TrailDetailReport['composedLayers']['surface']>,
      })
    ) as TrailDetailReport;

    expect(parsed.composedLayers.surface).toEqual({
      cli: [],
      http: [],
      mcp: ['mcp-A'],
    });
  });

  test('surface layer names can be read from execution context', () => {
    expect(
      readSurfaceLayerNamesFromContext({
        abortSignal: new AbortController().signal,
        extensions: {
          [SURFACE_LAYER_NAMES_KEY]: { cli: ['cli-A'], http: ['http-B'] },
        },
        requestId: 'req-1',
      })
    ).toEqual({ cli: ['cli-A'], http: ['http-B'] });
  });

  test('trail detail includes static activation graph chains', () => {
    const producer = structuredClone(
      deriveTrailDetail(signalProducer, signalApp)
    ) as TrailDetailReport;
    const consumer = structuredClone(
      deriveTrailDetail(signalConsumer, signalApp)
    ) as TrailDetailReport;
    const chain = {
      consumer: 'signal.consumer',
      producer: 'signal.producer',
      signal: 'hello.greeted',
    };

    expect(producer).toMatchObject({
      activatedBy: [],
      activates: ['signal.consumer'],
      activationChains: [chain],
      fires: ['hello.greeted'],
      on: [],
    });
    expect(consumer).toMatchObject({
      activatedBy: ['signal.producer'],
      activates: [],
      activationChains: [chain],
      activationEdges: [
        {
          hasWhere: false,
          sourceId: 'hello.greeted',
          sourceKey: 'signal:hello.greeted',
          sourceKind: 'signal',
          trailId: 'signal.consumer',
        },
      ],
      activationSources: [
        {
          id: 'hello.greeted',
          key: 'signal:hello.greeted',
          kind: 'signal',
        },
      ],
      fires: [],
      on: ['hello.greeted'],
    });
  });

  test('trail detail includes resolved TopoGraph contract fields for blind agents', () => {
    const account = contour(
      'account',
      {
        id: z.string(),
        name: z.string(),
      },
      { identity: 'id' }
    );
    const entity = contour(
      'entity',
      {
        accountId: account.id(),
        id: z.string(),
      },
      { identity: 'id' }
    );
    const topoPolicy = {
      input: z.object({ tenant: z.string() }),
      name: 'topo.policy',
      wrap: (_trail: unknown, implementation: unknown) =>
        implementation as never,
    };
    const trailAudit = {
      input: z.object({ requestId: z.string() }),
      name: 'trail.audit',
      wrap: (_trail: unknown, implementation: unknown) =>
        implementation as never,
    };
    const created = signal('entity.created', {
      payload: z.object({ id: z.string() }),
    });
    const auditSchedule = schedule('schedule.entity.audit', {
      cron: '0 2 * * *',
      input: { id: 'daily' },
      meta: { owner: 'entity' },
      timezone: 'UTC',
    });
    const process = trail('entity.process', {
      blaze: () => Result.ok({ ok: true }),
      contours: [entity],
      fields: { id: { hint: 'Entity id to process' } },
      fires: [created],
      input: z.object({ id: z.string() }),
      layers: [trailAudit],
      on: [auditSchedule],
      output: z.object({ ok: z.boolean() }),
    });
    const appWithGraphDetail = topo(
      'graph-detail-app',
      {
        account,
        created,
        entity,
        process,
      },
      { layers: [topoPolicy] }
    );

    const detail = structuredClone(
      deriveTrailDetail(process, appWithGraphDetail)
    ) as TrailDetailReport;

    expect(detail).toMatchObject({
      activationContext: {
        edgeCount: 1,
        sourceCount: 1,
        sourceKeys: ['schedule:schedule.entity.audit'],
        trailIds: ['entity.process'],
      },
      activationEdges: [
        {
          hasWhere: false,
          sourceId: 'schedule.entity.audit',
          sourceKey: 'schedule:schedule.entity.audit',
          sourceKind: 'schedule',
          trailId: 'entity.process',
        },
      ],
      cli: { path: ['entity', 'process'] },
      contours: ['entity'],
      fieldOverrides: [
        {
          field: 'id',
          overrides: ['hint'],
          provenance: { source: 'trail.fields' },
        },
      ],
      governance: null,
      layers: [
        {
          name: 'topo.policy',
          scope: 'topo',
        },
        {
          name: 'trail.audit',
          scope: 'trail',
        },
      ],
      surfaceProjections: [],
      surfaces: [],
    });
    expect(detail.contourDetails).toEqual([
      expect.objectContaining({
        id: 'entity',
        references: [
          {
            contour: 'account',
            field: 'accountId',
            identity: 'id',
          },
        ],
      }),
    ]);
    expect(detail.input).toMatchObject({ type: 'object' });
    expect(detail.output).toMatchObject({ type: 'object' });
    expect(trailDetailOutput.safeParse(detail).success).toBe(true);
  });

  test('trail detail scopes activation context to the requested trail', () => {
    const rebuildSchedule = schedule('schedule.report.rebuild', {
      cron: '0 3 * * *',
      timezone: 'UTC',
    });
    const pruneSchedule = schedule('schedule.report.prune', {
      cron: '0 4 * * *',
      timezone: 'UTC',
    });
    const rebuild = trail('report.rebuild', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [rebuildSchedule],
      output: z.object({ ok: z.boolean() }),
    });
    const prune = trail('report.prune', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [pruneSchedule],
      output: z.object({ ok: z.boolean() }),
    });
    const multiActivationApp = topo('multi-activation-app', { prune, rebuild });
    const topoGraph = deriveTopoGraph(multiActivationApp);

    const detail = structuredClone(
      deriveTrailDetail(rebuild, multiActivationApp, undefined, { topoGraph })
    ) as TrailDetailReport;

    expect(detail.activationContext).toEqual({
      edgeCount: 1,
      sourceCount: 1,
      sourceKeys: ['schedule:schedule.report.rebuild'],
      trailIds: ['report.rebuild'],
    });
    expect(detail.activationEdges).toEqual([
      {
        hasWhere: false,
        sourceId: 'schedule.report.rebuild',
        sourceKey: 'schedule:schedule.report.rebuild',
        sourceKind: 'schedule',
        trailId: 'report.rebuild',
      },
    ]);
  });

  test('trail detail reports complete shipped projections with authored provenance', () => {
    const httpVisible = trail('entity.http', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      surfaces: ['http'],
    } satisfies TrailSpec<unknown, { readonly ok: boolean }> & {
      readonly surfaces: readonly string[];
    });
    const authoredSurfaceApp = topo('authored-surface-app', { httpVisible });

    const detail = structuredClone(
      deriveTrailDetail(httpVisible, authoredSurfaceApp)
    ) as TrailDetailReport;

    expect(detail.surfaces).toEqual(['http']);
    expect(detail.surfaceProjections).toEqual([
      {
        commandPath: ['entity', 'http'],
        derivedName: 'entity http',
        method: null,
        source: 'default-derived',
        surface: 'cli',
        trailId: 'entity.http',
      },
      {
        derivedName: 'authored_surface_app_entity_http',
        method: null,
        source: 'default-derived',
        surface: 'mcp',
        toolName: 'authored_surface_app_entity_http',
        trailId: 'entity.http',
      },
      {
        derivedName: '/entity/http',
        method: 'POST',
        path: '/entity/http',
        source: 'authored',
        surface: 'http',
        trailId: 'entity.http',
      },
    ]);
  });

  test('surface projection output enforces surface-specific fields', () => {
    expect(
      surfaceProjectionOutput.safeParse({
        commandPath: ['entity', 'show'],
        derivedName: 'entity show',
        method: null,
        source: 'default-derived',
        surface: 'cli',
        trailId: 'entity.show',
      }).success
    ).toBe(true);
    expect(
      surfaceProjectionOutput.safeParse({
        derivedName: '/entity/show',
        method: 'GET',
        source: 'default-derived',
        surface: 'http',
        trailId: 'entity.show',
      }).success
    ).toBe(false);
  });

  test('shipped surface inventory covers public trails and planned websocket exclusion', () => {
    const internal = trail('entity.internal', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      visibility: 'internal',
    });
    const rebuildSchedule = schedule('schedule.entity.rebuild', {
      cron: '0 5 * * *',
    });
    const activated = trail('entity.activated', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [rebuildSchedule],
      output: z.object({ ok: z.boolean() }),
    });
    const show = trail('entity.show', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'read',
      output: z.object({ ok: z.boolean() }),
      surfaces: ['mcp'],
    } satisfies TrailSpec<unknown, { readonly ok: boolean }> & {
      readonly surfaces: readonly string[];
    });
    const inventoryApp = topo('inventory-app', { activated, internal, show });

    const report = deriveShippedSurfaceProjectionInventory(inventoryApp);

    expect(report.shippedSurfaces).toEqual(['cli', 'mcp', 'http']);
    expect(report.excludedSurfaces).toEqual([
      expect.objectContaining({
        status: 'planned',
        surface: 'websocket',
      }),
    ]);
    expect(report.trails.map((row) => row.trailId)).toEqual(['entity.show']);
    expect(report.projections).toEqual([
      {
        commandPath: ['entity', 'show'],
        derivedName: 'entity show',
        method: null,
        source: 'default-derived',
        surface: 'cli',
        trailId: 'entity.show',
      },
      {
        derivedName: 'inventory_app_entity_show',
        method: null,
        source: 'authored',
        surface: 'mcp',
        toolName: 'inventory_app_entity_show',
        trailId: 'entity.show',
      },
      {
        derivedName: '/entity/show',
        method: 'GET',
        path: '/entity/show',
        source: 'default-derived',
        surface: 'http',
        trailId: 'entity.show',
      },
    ]);
    expect(shippedSurfaceInventoryOutput.safeParse(report).success).toBe(true);
  });

  test('trail detail clamps detour maxAttempts to the owner cap', () => {
    const detail = deriveTrailDetail(
      trail('retrying', {
        blaze: () => Result.ok(),
        detours: [
          {
            maxAttempts: 100,
            on: ConflictError,
            recover: () => Result.ok(),
          },
        ],
        input: z.object({}),
      })
    );

    expect(detail.detours).toEqual([
      { maxAttempts: DETOUR_MAX_ATTEMPTS_CAP, on: 'ConflictError' },
    ]);
  });
});

describe('trails survey lookup', () => {
  test('isolated survey examples keep their rootDir through input validation', () => {
    const overviewExample = surveyTrail.examples?.find(
      (example) => example.name === 'Overview'
    );
    const detailExample = surveyTrailDetailTrail.examples?.find(
      (example) => example.name === 'Trail detail'
    );
    const briefExample = surveyBriefTrail.examples?.find(
      (example) => example.name === 'Brief capability report'
    );
    const overviewInput = overviewExample?.input as
      | { readonly module?: string; readonly rootDir?: string }
      | undefined;
    const detailInput = detailExample?.input as
      | { readonly module?: string; readonly rootDir?: string }
      | undefined;
    const briefInput = briefExample?.input as
      | { readonly module?: string; readonly rootDir?: string }
      | undefined;

    expect(overviewInput?.rootDir).toBeDefined();
    expect(detailInput?.rootDir).toBeDefined();
    expect(briefInput?.rootDir).toBeDefined();

    const parsedOverview = surveyTrail.input.safeParse(overviewInput);
    const parsedDetail = surveyTrailDetailTrail.input.safeParse(detailInput);
    const parsedBrief = surveyBriefTrail.input.safeParse(briefInput);

    expect(parsedOverview.success).toBe(true);
    expect(parsedDetail.success).toBe(true);
    expect(parsedBrief.success).toBe(true);
    if (parsedOverview.success && parsedDetail.success && parsedBrief.success) {
      expect(parsedOverview.data.rootDir).toBe(overviewInput?.rootDir);
      expect(parsedDetail.data.rootDir).toBe(detailInput?.rootDir);
      expect(parsedBrief.data.rootDir).toBe(briefInput?.rootDir);
    }
  });

  test('surface inventory survey example keeps its rootDir through input validation', () => {
    const example = surveySurfacesTrail.examples?.find(
      (item) => item.name === 'Shipped surface inventory'
    );
    const input = example?.input as
      | { readonly module?: string; readonly rootDir?: string }
      | undefined;

    expect(input?.rootDir).toBeDefined();

    const parsed = surveySurfacesTrail.input.safeParse(input);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rootDir).toBe(input?.rootDir);
    }
  });

  test('bare survey returns the overview shape', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const overview = expectOk(
        await surveyTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );

      expect(overview).toMatchObject({
        count: 1,
        mode: 'overview',
        resourceCount: 1,
        signalCount: 0,
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('id lookup returns all matching entity kinds', async () => {
    const dir = repoTempDir();

    try {
      writeMultiMatchAppFixture(dir);

      const lookup = expectOk(
        await surveyTrail.blaze({ id: 'shared', module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly matches: readonly {
          readonly detail: { readonly id: string };
          readonly kind: string;
        }[];
        readonly mode: 'lookup';
      };

      expect(lookup.mode).toBe('lookup');
      expect(lookup.matches.map((match) => match.kind)).toEqual([
        'trail',
        'resource',
        'signal',
      ]);
      expect(
        lookup.matches.every((match) => match.detail.id === 'shared')
      ).toBe(true);

      const detailByKind = new Map(
        lookup.matches.map((match) => [match.kind, match.detail])
      );
      expect(detailByKind.get('trail')).toMatchObject({
        activationChains: [],
        fires: ['shared'],
      });
      expect(detailByKind.get('resource')).toMatchObject({
        usedBy: ['shared'],
      });
      expect(detailByKind.get('signal')).toMatchObject({
        consumers: [],
        producers: ['shared'],
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('id lookup returns an empty match list when nothing matches', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const lookup = expectOk(
        await surveyTrail.blaze({ id: 'missing', module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly matches: readonly unknown[];
        readonly mode: 'lookup';
      };

      expect(lookup).toEqual({ matches: [], mode: 'lookup' });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('typed survey accessors return one kind or NotFound', async () => {
    const dir = repoTempDir();

    try {
      writeMultiMatchAppFixture(dir);

      const trailDetail = expectOk(
        await surveyTrailDetailTrail.blaze(
          { id: 'shared', module: './src/app.ts' },
          { cwd: dir } as never
        )
      );
      expect(trailDetail.kind).toBe('trail');

      const resourceDetail = expectOk(
        await surveyResourceTrail.blaze(
          { id: 'shared', module: './src/app.ts' },
          { cwd: dir } as never
        )
      );
      expect(resourceDetail.kind).toBe('resource');

      const signalDetail = expectOk(
        await surveySignalTrail.blaze(
          { id: 'shared', module: './src/app.ts' },
          { cwd: dir } as never
        )
      );
      expect(signalDetail.kind).toBe('signal');

      const missing = await surveyTrailDetailTrail.blaze(
        { id: 'missing', module: './src/app.ts' },
        { cwd: dir } as never
      );
      expect(missing.isErr()).toBe(true);
      expect(missing.error.message).toBe('Trail not found: missing');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('trails survey resources section', () => {
  test('list output includes resource lifetime and health status', () => {
    const report = deriveSurveyList(app);
    const parsed = structuredClone(report) as SurveyListReport;
    const db = parsed.resources.find((entry) => entry.id === 'db.main');

    expect(parsed.resourceCount).toBe(1);
    expect(db).toEqual({
      description: null,
      health: 'none',
      id: 'db.main',
      kind: 'resource',
      lifetime: 'singleton',
      usedBy: ['hello'],
    });
  });
});

describe('trails survey activation graph', () => {
  test('list output includes static activation overview and trail relations', () => {
    const report = deriveSurveyList(signalApp);
    const parsed = structuredClone(report) as SurveyListReport;
    const consumer = parsed.entries.find(
      (entry) => entry.id === 'signal.consumer'
    );
    const producer = parsed.entries.find(
      (entry) => entry.id === 'signal.producer'
    );

    expect(parsed.activation).toEqual({
      chainCount: 1,
      chains: [
        {
          consumer: 'signal.consumer',
          producer: 'signal.producer',
          signal: 'hello.greeted',
        },
      ],
      edgeCount: 1,
      edges: [
        {
          hasWhere: false,
          sourceId: 'hello.greeted',
          sourceKey: 'signal:hello.greeted',
          sourceKind: 'signal',
          trailId: 'signal.consumer',
        },
      ],
      signalIds: ['hello.greeted'],
      sourceCount: 1,
      sourceKeys: ['signal:hello.greeted'],
      trailIds: ['signal.consumer', 'signal.producer'],
    });
    expect(producer).toMatchObject({
      activatedBy: [],
      activates: ['signal.consumer'],
    });
    expect(consumer).toMatchObject({
      activatedBy: ['signal.producer'],
      activates: [],
    });
  });

  test('list and detail output include generic activation source edges', () => {
    const nightly = schedule('schedule.report.rebuild', {
      cron: '0 3 * * *',
      input: { id: 'nightly' },
      meta: { owner: 'reports' },
      timezone: 'UTC',
    });
    const scheduledTrail = trail('report.rebuild', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [nightly],
      output: z.object({ ok: z.boolean() }),
    });
    const scheduledApp = topo('scheduled-app', { scheduledTrail });

    const overview = structuredClone(
      deriveSurveyList(scheduledApp)
    ) as SurveyListReport;
    const detail = structuredClone(
      deriveTrailDetail(scheduledTrail, scheduledApp)
    ) as TrailDetailReport;

    expect(overview.activation).toMatchObject({
      chainCount: 0,
      edgeCount: 1,
      signalIds: [],
      sourceCount: 1,
      sourceKeys: ['schedule:schedule.report.rebuild'],
      trailIds: ['report.rebuild'],
    });
    expect(overview.activation.edges).toEqual([
      {
        hasWhere: false,
        sourceId: 'schedule.report.rebuild',
        sourceKey: 'schedule:schedule.report.rebuild',
        sourceKind: 'schedule',
        trailId: 'report.rebuild',
      },
    ]);
    expect(detail.activationSources).toEqual([
      {
        cron: '0 3 * * *',
        id: 'schedule.report.rebuild',
        input: { id: 'nightly' },
        key: 'schedule:schedule.report.rebuild',
        kind: 'schedule',
        meta: { owner: 'reports' },
        timezone: 'UTC',
      },
    ]);
    expect(detail.activationEdges).toEqual(overview.activation.edges);
  });

  test('trail detail activation sources preserve parse and payload schemas', () => {
    const webhookSource = webhook('webhook.user.upsert', {
      method: 'post',
      parse: {
        output: z.object({
          email: z.string().optional(),
          userId: z.string(),
        }),
      },
      path: '/webhooks/users/upsert',
      payload: z.object({ userId: z.string() }),
      verify: () => Result.ok(),
    });
    const receiver = trail('user.webhook.receive', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ userId: z.string() }),
      on: [webhookSource],
      output: z.object({ ok: z.boolean() }),
    });
    const webhookApp = topo('webhook-app', { receiver });

    const detail = structuredClone(
      deriveTrailDetail(receiver, webhookApp)
    ) as TrailDetailReport;

    expect(trailDetailOutput.safeParse(detail).success).toBe(true);
    expect(detail.activationSources).toEqual([
      {
        hasParse: true,
        hasPayloadSchema: true,
        hasVerify: true,
        id: 'webhook.user.upsert',
        key: 'webhook:webhook.user.upsert',
        kind: 'webhook',
        method: 'POST',
        parseOutputSchema: {
          properties: {
            email: { type: 'string' },
            userId: { type: 'string' },
          },
          required: ['userId'],
          type: 'object',
        },
        path: '/webhooks/users/upsert',
        payloadSchema: {
          properties: {
            userId: { type: 'string' },
          },
          required: ['userId'],
          type: 'object',
        },
      },
    ]);
  });
});

describe('trails survey signals section', () => {
  test('list output includes signal examples and graph relations', () => {
    const report = deriveSurveyList(signalApp);
    const parsed = structuredClone(report) as SurveyListReport;
    const entry = parsed.signals.find(
      (signalEntry) => signalEntry.id === 'hello.greeted'
    );

    expect(parsed.signalCount).toBe(1);
    expect(entry).toEqual({
      consumers: ['signal.consumer'],
      description: 'A greeting was produced',
      examples: 1,
      from: ['signal.producer'],
      id: 'hello.greeted',
      kind: 'signal',
      payloadSchema: true,
      producers: ['signal.producer'],
    });
  });

  test('signal detail includes payload schema, examples, and relations', () => {
    const detail = deriveSignalDetail(signalApp, 'hello.greeted');
    const parsed = structuredClone(detail) as SignalDetailReport;

    expect(parsed).toMatchObject({
      consumers: ['signal.consumer'],
      description: 'A greeting was produced',
      examples: [{ name: 'Ada' }],
      from: ['signal.producer'],
      id: 'hello.greeted',
      kind: 'signal',
      producers: ['signal.producer'],
    });
    expect(parsed.payload).toMatchObject({
      properties: { name: { type: 'string' } },
      type: 'object',
    });
  });
});

describe('trails compile', () => {
  test('writes the structured topo artifacts', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const compiled = expectOk(
        await compileTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly hash: string;
        readonly lockPath: string;
        readonly snapshot: unknown;
        readonly topoPath: string;
      };

      expect(compiled.hash).toHaveLength(64);
      expect(compiled.topoPath).toBe(join(dir, '.trails', 'topo.lock'));
      expect(existsSync(join(dir, '.trails', 'topo.lock'))).toBe(true);
      expect(existsSync(join(dir, '.trails', 'trails.lock'))).toBe(true);
      expect(
        JSON.parse(readFileSync(join(dir, '.trails', 'trails.lock'), 'utf8'))
      ).toMatchObject({
        artifacts: [{ path: 'topo.lock', role: 'topo', sha256: compiled.hash }],
        version: 3,
      });
      expect(compileTrail.output.safeParse(compiled).success).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('blocks breaking topo changes unless forced and records force events', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      expectOk(
        await compileTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );

      writeSurveyAppFixture(dir, { helloNameRequired: true });
      const blocked = await compileTrail.blaze({ module: './src/app.ts' }, {
        cwd: dir,
      } as never);
      expect(blocked.isErr()).toBe(true);
      expect(blocked.error).toBeInstanceOf(ConflictError);
      expect(blocked.error?.message).toContain('breaking change');

      const forced = expectOk(
        await compileTrail.blaze({ force: true, module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly hash: string;
        readonly lockPath: string;
        readonly topoPath: string;
      };
      const graph = JSON.parse(
        readFileSync(join(dir, '.trails', 'topo.lock'), 'utf8')
      ) as TopoGraph;
      const hello = graph.entries.find((entry) => entry.id === 'hello');

      expect(hello?.forces?.[0]).toMatchObject({
        severity: 'breaking',
        source: 'trails compile --force',
      });
      expect(
        JSON.parse(readFileSync(join(dir, '.trails', 'trails.lock'), 'utf8'))
      ).toMatchObject({
        artifacts: [{ path: 'topo.lock', role: 'topo', sha256: forced.hash }],
      });
      const validated = expectOk(
        await validateTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );
      expect(validated.stale).toBe(false);
      const forcedArtifacts = await loadWayfinderArtifacts({ rootDir: dir });
      expect(forcedArtifacts.artifactStatus).toEqual({ status: 'fresh' });
      expect(validated.currentHash).toBe(
        deriveTopoGraphHash(stripTopoGraphForces(graph))
      );
      expect(validated.currentHash).not.toBe(validated.committedHash);
      const recompiled = expectOk(
        await compileTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly hash: string;
      };
      const recompiledGraph = JSON.parse(
        readFileSync(join(dir, '.trails', 'topo.lock'), 'utf8')
      ) as TopoGraph;
      const recompiledHello = recompiledGraph.entries.find(
        (entry) => entry.id === 'hello'
      );

      expect(recompiledHello?.forces?.[0]).toMatchObject({
        severity: 'breaking',
        source: 'trails compile --force',
      });
      expect(recompiled.hash).toBe(forced.hash);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('blocked breaking compile keeps saved Wayfinder artifacts fresh', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      expectOk(
        await compileTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );
      const snapshotCountAfterExport = countTopoSnapshots(dir);

      writeSurveyAppFixture(dir, { helloNameRequired: true });
      const blocked = await compileTrail.blaze({ module: './src/app.ts' }, {
        cwd: dir,
      } as never);
      expect(blocked.isErr()).toBe(true);
      expect(blocked.error).toBeInstanceOf(ConflictError);
      expect(blocked.error?.message).toContain('breaking change');
      expect(countTopoSnapshots(dir)).toBe(snapshotCountAfterExport);

      const loaded = await loadWayfinderArtifacts({ rootDir: dir });
      expect(loaded.artifactStatus).toEqual({ status: 'fresh' });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('forced removed trails are recorded as graph force events', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir, { withBye: true });
      expectOk(
        await compileTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );

      writeSurveyAppFixture(dir);
      const forced = expectOk(
        await compileTrail.blaze({ force: true, module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly hash: string;
      };
      const graph = JSON.parse(
        readFileSync(join(dir, '.trails', 'topo.lock'), 'utf8')
      ) as TopoGraph;

      expect(graph.entries.some((entry) => entry.id === 'bye')).toBe(false);
      expect(graph.forces?.[0]).toMatchObject({
        change: 'removed',
        id: 'bye',
        kind: 'trail',
        source: 'trails compile --force',
      });
      expect(
        JSON.parse(readFileSync(join(dir, '.trails', 'trails.lock'), 'utf8'))
      ).toMatchObject({
        artifacts: [{ path: 'topo.lock', role: 'topo', sha256: forced.hash }],
      });
      const validated = expectOk(
        await validateTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      );
      expect(validated.stale).toBe(false);
      const recompiled = expectOk(
        await compileTrail.blaze({ module: './src/app.ts' }, {
          cwd: dir,
        } as never)
      ) as {
        readonly hash: string;
      };
      const recompiledGraph = JSON.parse(
        readFileSync(join(dir, '.trails', 'topo.lock'), 'utf8')
      ) as TopoGraph;

      expect(recompiledGraph.forces?.[0]).toMatchObject({
        change: 'removed',
        id: 'bye',
        kind: 'trail',
        source: 'trails compile --force',
      });
      expect(recompiled.hash).toBe(forced.hash);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('trails survey diff', () => {
  test('top-level diff projects as a root CLI alias with target arg', () => {
    const commands = expectOk(
      deriveCliCommands(topo('diff-cli', { surveyDiffTrail }), {
        aliases: { 'survey.diff': [['diff']] },
      })
    );
    const command = commands.find(
      (candidate) => candidate.trail.id === 'survey.diff'
    );

    expect(command?.path).toEqual(['survey', 'diff']);
    expect(command?.routes).toContainEqual({
      kind: 'alias',
      path: ['diff'],
      source: 'surface',
      target: 'survey.diff',
    });
    expect(command?.args.map((arg) => arg.name)).toContain('target');
    expect(command?.flags.map((flag) => flag.name)).toContain('breaks');
    expect(command?.flags.map((flag) => flag.name)).toContain('forces');
  });

  test('input validation preserves an isolated example rootDir', () => {
    const parsed = surveyDiffTrail.input.safeParse({
      against: 'saved',
      module: './src/app.ts',
      rootDir: '/tmp/trails-survey-diff',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rootDir).toBe('/tmp/trails-survey-diff');
    }
  });

  test('returns an error when no saved TopoGraph exists yet', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const result = await surveyDiffTrail.blaze({ module: './src/app.ts' }, {
        cwd: dir,
      } as never);

      expect(result.isErr()).toBe(true);
      expect(result.error.message).toContain('Run `trails compile` first');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('diffs against the saved local TopoGraph', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeTopoGraph(deriveTopoGraph(baselineApp), {
        dir: join(dir, '.trails'),
      });

      writeSurveyAppFixture(dir, { withBye: true });

      const result = await surveyDiffTrail.blaze({ module: './src/app.ts' }, {
        cwd: dir,
      } as never);

      expect(result.isOk()).toBe(true);
      expect(result.value).toMatchObject({
        against: 'saved',
        hasBreaking: false,
        info: [
          expect.objectContaining({
            change: 'added',
            id: 'bye',
          }),
        ],
        mode: 'diff',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('top-level diff filters by trail target', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeTopoGraph(deriveTopoGraph(baselineApp), {
        dir: join(dir, '.trails'),
      });

      writeSurveyAppFixture(dir, { withBye: true });

      const byeDiff = await surveyDiffTrail.blaze(
        { module: './src/app.ts', target: 'bye' },
        { cwd: dir } as never
      );
      const helloDiff = await surveyDiffTrail.blaze(
        { module: './src/app.ts', target: 'hello' },
        { cwd: dir } as never
      );

      expect(byeDiff.isOk()).toBe(true);
      expect(byeDiff.value.info).toEqual([
        expect.objectContaining({ id: 'bye' }),
      ]);
      expect(helloDiff.isOk()).toBe(true);
      expect(helloDiff.value.info).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('top-level diff rejects unknown plain trail targets', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeTopoGraph(deriveTopoGraph(baselineApp), {
        dir: join(dir, '.trails'),
      });

      const result = await surveyDiffTrail.blaze(
        { module: './src/app.ts', target: 'missing.plain' },
        { cwd: dir } as never
      );

      expect(result.isErr()).toBe(true);
      expect(result.error.message).toContain(
        'Trail not found for diff: missing.plain'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('top-level diff filters graph-only force audit events', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      const baseline = deriveTopoGraph(baselineApp);
      const hello = baseline.entries.find((entry) => entry.id === 'hello');
      if (hello === undefined) {
        throw new Error('expected fixture topo entry');
      }
      writeFileSync(
        join(dir, 'baseline.json'),
        JSON.stringify({
          ...baseline,
          entries: [
            {
              ...hello,
              forces: [
                {
                  acceptedAt: '2026-05-20T00:00:00.000Z',
                  change: 'modified',
                  detail: 'Required input field "name" added',
                  id: 'hello',
                  kind: 'trail',
                  severity: 'breaking',
                  source: 'trails compile --force',
                },
              ],
            },
          ],
        } satisfies TopoGraph)
      );

      const result = await surveyDiffTrail.blaze(
        {
          against: 'baseline.json',
          forces: true,
          module: './src/app.ts',
          target: 'hello@1..2',
        },
        { cwd: dir } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value.warnings[0]?.details).toEqual([
        'Force event removed: modified Required input field "name" added',
      ]);
      expect(result.value.info).toEqual([]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('can diff against a workspace-relative TopoGraph directory', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeTopoGraph(deriveTopoGraph(baselineApp), {
        dir: join(dir, 'baselines'),
      });

      writeSurveyAppFixture(dir, { withBye: true });

      const result = await surveyDiffTrail.blaze(
        { against: 'baselines', breakingOnly: true, module: './src/app.ts' },
        { cwd: dir } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value).toMatchObject({
        against: 'baselines',
        hasBreaking: false,
        info: [],
        mode: 'diff',
        warnings: [],
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('version-range diff keeps supported-version details in range', async () => {
    const dir = repoTempDir();

    try {
      writeVersionedDiffAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeTopoGraph(deriveTopoGraph(baselineApp), {
        dir: join(dir, 'baselines'),
      });

      writeVersionedDiffAppFixture(dir, { archiveV1: true });

      const result = await surveyDiffTrail.blaze(
        {
          against: 'baselines',
          module: './src/app.ts',
          target: 'versioned@1..1',
        },
        { cwd: dir } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value.breaking[0]?.details).toContain(
        'Supported versions removed: 1'
      );
      expect(result.value.breaking[0]?.details).toContain(
        'Version 1 status changed: live -> archived'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('version-range diff recomputes severity after filtering details', async () => {
    const dir = repoTempDir();

    try {
      writeVersionedDiffAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeTopoGraph(deriveTopoGraph(baselineApp), {
        dir: join(dir, 'baselines'),
      });

      writeVersionedDiffAppFixture(dir, {
        archiveV1: true,
        deprecateV2: true,
      });

      const result = await surveyDiffTrail.blaze(
        {
          against: 'baselines',
          module: './src/app.ts',
          target: 'versioned@2..2',
        },
        { cwd: dir } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value).toMatchObject({
        breaking: [],
        hasBreaking: false,
        warnings: [],
      });
      expect(result.value.info[0]).toMatchObject({
        details: ['Version 2 status changed: live -> deprecated'],
        severity: 'info',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('version-range diff keeps removed deprecated versions breaking', async () => {
    const dir = repoTempDir();

    try {
      writeVersionedDiffAppFixture(dir, { deprecateV1: true });
      const baselineApp = await loadApp('./src/app.ts', dir);
      const baselineGraph = deriveTopoGraph(baselineApp);
      await writeTopoGraph(
        {
          ...baselineGraph,
          entries: baselineGraph.entries.map((entry) =>
            entry.id === 'versioned'
              ? {
                  ...entry,
                  supports: entry.supports?.filter((version) => version !== 1),
                }
              : entry
          ),
        },
        { dir: join(dir, 'baselines') }
      );

      writeVersionedDiffAppFixture(dir, { omitV1: true });

      const result = await surveyDiffTrail.blaze(
        {
          against: 'baselines',
          module: './src/app.ts',
          target: 'versioned@1..1',
        },
        { cwd: dir } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value).toMatchObject({
        hasBreaking: true,
        info: [],
        warnings: [],
      });
      expect(result.value.breaking[0]).toMatchObject({
        details: ['Version 1 removed (deprecated)'],
        severity: 'breaking',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('version-range diff rejects unknown trail ids', async () => {
    const dir = repoTempDir();

    try {
      writeVersionedDiffAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeTopoGraph(deriveTopoGraph(baselineApp), {
        dir: join(dir, 'baselines'),
      });

      const result = await surveyDiffTrail.blaze(
        {
          against: 'baselines',
          module: './src/app.ts',
          target: 'missing.versioned@1..2',
        },
        { cwd: dir } as never
      );

      expect(result.isErr()).toBe(true);
      expect(result.error.message).toContain(
        'Trail not found for diff: missing.versioned'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('can diff against a workspace-relative JSON TopoGraph file', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      writeFileSync(
        join(dir, 'baseline.json'),
        JSON.stringify(deriveTopoGraph(baselineApp))
      );

      writeSurveyAppFixture(dir, { withBye: true });

      const result = await surveyDiffTrail.blaze(
        { against: 'baseline.json', module: './src/app.ts' },
        { cwd: dir } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value).toMatchObject({
        against: 'baseline.json',
        hasBreaking: false,
        info: [
          expect.objectContaining({
            change: 'added',
            id: 'bye',
          }),
        ],
        mode: 'diff',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('can diff against a workspace-relative topo.lock file', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeTopoGraph(deriveTopoGraph(baselineApp), {
        dir: join(dir, 'baseline-dir'),
      });

      writeSurveyAppFixture(dir, { withBye: true });

      const result = await surveyDiffTrail.blaze(
        { against: 'baseline-dir/topo.lock', module: './src/app.ts' },
        { cwd: dir } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value).toMatchObject({
        against: 'baseline-dir/topo.lock',
        hasBreaking: false,
        info: [
          expect.objectContaining({
            change: 'added',
            id: 'bye',
          }),
        ],
        mode: 'diff',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reports attempted resolution strategies for missing diff targets', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);

      const result = await surveyDiffTrail.blaze(
        { against: 'baselins', module: './src/app.ts' },
        { cwd: dir } as never
      );

      expect(result.isErr()).toBe(true);
      expect(result.error.message).toContain(
        'No TopoGraph found for: baselins'
      );
      expect(result.error.message).toContain(
        'workspace-relative directory containing topo.lock'
      );
      expect(result.error.message).toContain(
        'topo-store pin and snapshot references'
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('reads explicit diff paths before opening the topo store', async () => {
    const dir = repoTempDir();

    try {
      writeSurveyAppFixture(dir);
      const baselineApp = await loadApp('./src/app.ts', dir);
      await writeTopoGraph(deriveTopoGraph(baselineApp), {
        dir: join(dir, 'baselines'),
      });
      mkdirSync(join(dir, '.trails', 'state'), { recursive: true });
      writeFileSync(join(dir, '.trails', 'state', 'trails.db'), 'not sqlite');

      writeSurveyAppFixture(dir, { withBye: true });

      const result = await surveyDiffTrail.blaze(
        { against: 'baselines', module: './src/app.ts' },
        { cwd: dir } as never
      );

      expect(result.isOk()).toBe(true);
      expect(result.value).toMatchObject({
        against: 'baselines',
        hasBreaking: false,
        info: [
          expect.objectContaining({
            change: 'added',
            id: 'bye',
          }),
        ],
        mode: 'diff',
      });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe('trails survey output schema', () => {
  test('uses mode as the public discriminant', () => {
    expect(
      surveyTrail.output.safeParse({
        ...deriveSurveyList(app),
        mode: 'overview',
      }).success
    ).toBe(true);
    expect(
      surveyTrail.output.safeParse({
        matches: [
          { detail: deriveTrailDetail(helloTrail), kind: 'trail' },
          {
            detail: {
              description: null,
              health: 'none',
              id: 'db.main',
              kind: 'resource',
              lifetime: 'singleton',
              usedBy: ['hello'],
            },
            kind: 'resource',
          },
          {
            detail: deriveSignalDetail(signalApp, 'hello.greeted'),
            kind: 'signal',
          },
        ],
        mode: 'lookup',
      }).success
    ).toBe(true);
    expect(
      surveyBriefTrail.output.safeParse(deriveBriefReport(app)).success
    ).toBe(true);
    expect(
      surveySurfacesTrail.output.safeParse(
        deriveShippedSurfaceProjectionInventory(app)
      ).success
    ).toBe(true);
    expect(
      surveyDiffTrail.output.safeParse({
        against: 'saved',
        breaking: [],
        hasBreaking: false,
        info: [],
        mode: 'diff',
        warnings: [],
      }).success
    ).toBe(true);
    expect(
      surveyDiffTrail.output.safeParse({
        against: 'saved',
        breaking: [],
        hasBreaking: false,
        info: [],
        mode: 'diff',
        warnings: [],
      }).success
    ).toBe(true);
    expect(
      compileTrail.output.safeParse({
        hash: 'a'.repeat(64),
        lockPath: '.trails/trails.lock',
        snapshot: {
          createdAt: new Date(0).toISOString(),
          gitDirty: false,
          id: 'snapshot-1',
          resourceCount: 1,
          signalCount: 0,
          trailCount: 2,
        },
        topoPath: '.trails/topo.lock',
      }).success
    ).toBe(true);
    expect(
      surveyTrailDetailTrail.output.safeParse(deriveTrailDetail(helloTrail))
        .success
    ).toBe(true);
    expect(
      surveyResourceTrail.output.safeParse({
        description: null,
        health: 'none',
        id: 'db.main',
        kind: 'resource',
        lifetime: 'singleton',
        usedBy: ['hello'],
      }).success
    ).toBe(true);
    expect(
      surveySignalTrail.output.safeParse(
        deriveSignalDetail(signalApp, 'hello.greeted')
      ).success
    ).toBe(true);
  });
});
