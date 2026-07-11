import { deriveCliCommands } from '@ontrails/cli';
import { Result } from '@ontrails/core';
import { describe, expect, test } from 'bun:test';

import {
  app,
  operatorApp,
  trailsCliIncludedTrails,
  trailsOverlays,
} from '../app.js';
import { formatWayfindOutlineText } from '../run-wayfind-outline.js';
import { wayfindTrail } from '../trails/wayfind.js';

const unwrapCommands = () => {
  const result = deriveCliCommands(app, {
    include: trailsCliIncludedTrails,
    overlays: trailsOverlays,
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const parseWayfindInput = (input: Record<string, unknown>) => {
  const { resolver, ...publicInput } = input;
  return {
    ...wayfindTrail.input.parse(publicInput),
    ...(typeof resolver === 'string' ? { resolver } : {}),
  };
};

const fakeWayfindContext = () => {
  const calls: { id: string; input: unknown }[] = [];
  return {
    calls,
    ctx: {
      compose: async (id: string, input: unknown) => {
        calls.push({ id, input });
        return Result.ok({ id, input });
      },
      cwd: process.cwd(),
    },
  };
};

describe('Trails Wayfinder CLI surface', () => {
  test('projects selected Wayfinder queries as local CLI commands', () => {
    const commands = unwrapCommands();
    const commandPaths = commands.map((command) => command.path.join(' '));
    const trailIds = commands.map((command) => command.trail.id);

    expect(commandPaths).toContain('wayfind');
    expect(commandPaths).toContain('wayfind pattern');
    expect(commandPaths).toContain('wayfind query');
    expect(commandPaths).toContain('wayfind file');
    expect(commandPaths).toContain('wayfind diff');
    expect(commandPaths).not.toContain('wayfind adapters');
    expect(commandPaths).not.toContain('wayfind search');
    expect(commandPaths).not.toContain('wayfind contract');
    expect(commandPaths).not.toContain('wayfind describe');
    expect(commandPaths).not.toContain('wayfind nearby');
    expect(commandPaths).not.toContain('wayfind impact');
    expect(commandPaths).not.toContain('wayfind outline');
    expect(commandPaths).not.toContain('wayfind entities');
    expect(commandPaths).not.toContain('wayfind trailheads');
    expect(commandPaths).not.toContain('wayfind signals');

    expect(trailIds).toContain('wayfind.navigate');
    expect(trailIds).toContain('wayfind.pattern');
    expect(trailIds).toContain('wayfind.query');
    expect(trailIds).toContain('wayfind.file');
    expect(trailIds).toContain('wayfind.diff');
    expect(trailIds).not.toContain('wayfind.adapters');
    expect(trailIds).not.toContain('wayfind.search');
    expect(trailIds).not.toContain('wayfind.contract');
    expect(trailIds).not.toContain('wayfind.describe');
    expect(trailIds).not.toContain('wayfind.nearby');
    expect(trailIds).not.toContain('wayfind.impact');
    expect(trailIds).not.toContain('wayfind.outline');
    expect(trailIds).not.toContain('wayfind.entities');
    expect(trailIds).not.toContain('wayfind.trailheads');
    expect(trailIds).not.toContain('wayfind.signals');

    const file = commands.find(
      (command) => command.trail.id === 'wayfind.file'
    );
    expect(file?.args.map((arg) => arg.name)).toEqual(['selector']);
    expect(file?.flags.map((flag) => flag.name)).toEqual(
      expect.arrayContaining(['outline'])
    );
    expect(file?.flags.map((flag) => flag.name)).not.toContain('view');

    const navigate = commands.find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate?.args.map((arg) => arg.name)).toEqual(['target']);
    expect(navigate?.flags.map((flag) => flag.name)).toEqual(
      expect.arrayContaining([
        'adapter',
        'contract',
        'entities',
        'depth',
        'deps',
        'describe',
        'errors',
        'trailheads',
        'impact',
        'include',
        'map',
        'module',
        'outline',
        'overview',
        'signals',
      ])
    );
    expect(navigate?.flags.map((flag) => flag.name)).not.toContain('adapters');
    expect(navigate?.flags.map((flag) => flag.name)).not.toContain('around');
    expect(navigate?.flags.map((flag) => flag.name)).not.toContain('from');
    expect(navigate?.flags.map((flag) => flag.name)).not.toContain('to');
    expect(navigate?.routes).toEqual([
      {
        kind: 'canonical',
        path: ['wayfind'],
        source: 'trail',
        target: 'wayfind.navigate',
      },
    ]);

    const pattern = commands.find(
      (command) => command.trail.id === 'wayfind.pattern'
    );
    expect(pattern?.flags.map((flag) => flag.name)).not.toContain('view');
    expect(pattern?.flags.map((flag) => flag.name)).not.toContain('outline');
    expect(pattern?.routes).toEqual([
      {
        kind: 'canonical',
        path: ['wayfind', 'pattern'],
        source: 'trail',
        target: 'wayfind.pattern',
      },
    ]);

    const query = commands.find(
      (command) => command.trail.id === 'wayfind.query'
    );
    expect(query?.flags.map((flag) => flag.name)).not.toContain('view');
    expect(query?.flags.map((flag) => flag.name)).not.toContain('outline');
  });

  test('guards against conflicting relational wayfind targets', async () => {
    const navigate = unwrapCommands().find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate).toBeDefined();

    const result = await navigate?.execute(
      { target: 'wayfind.search' },
      { deps: true, impact: true },
      { cwd: process.cwd() }
    );

    expect(result?.isErr()).toBe(true);
    expect(result?.error.message).toContain('Provide only one relation flag');
  });

  test('guards live source against unsupported relational views', async () => {
    const navigate = unwrapCommands().find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate).toBeDefined();

    const result = await navigate?.execute(
      {},
      { deps: true, source: 'live', target: 'db.main' },
      { cwd: process.cwd() }
    );

    expect(result?.isErr()).toBe(true);
    expect(result?.error.message).toContain('supports overview and ID lookup');
  });

  test('guards live source against typed population selectors', async () => {
    const navigate = unwrapCommands().find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate).toBeDefined();

    for (const flag of ['entities', 'signals', 'trailheads'] as const) {
      const result = await navigate?.execute(
        {},
        { [flag]: true, source: 'live' },
        { cwd: process.cwd() }
      );

      expect(result?.isErr()).toBe(true);
      expect(result?.error.message).toContain(
        'use locked artifacts for typed filters'
      );
    }
  });

  test('guards includes against live source and relational views', async () => {
    const navigate = unwrapCommands().find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate).toBeDefined();

    const live = await navigate?.execute(
      {},
      { include: ['examples'], source: 'live' },
      { cwd: process.cwd() }
    );
    expect(live?.isErr()).toBe(true);
    expect(live?.error.message).toContain(
      '--include attaches facts to a target or filtered population'
    );

    const relation = await navigate?.execute(
      {},
      { impact: true, include: ['examples'], target: 'wayfind.search' },
      { cwd: process.cwd() }
    );
    expect(relation?.isErr()).toBe(true);
    expect(relation?.error.message).toContain(
      '--include attaches facts to a target or filtered population'
    );
  });

  test('rejects --overlay combined with targets, selectors, or includes', async () => {
    const navigate = unwrapCommands().find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate).toBeDefined();

    for (const flags of [
      { overlay: 'cloudflare', target: 'wayfind.search' },
      { overlay: 'cloudflare', trails: true },
      { include: ['examples'], overlay: 'cloudflare' },
    ]) {
      const result = await navigate?.execute({}, flags, {
        cwd: process.cwd(),
      });

      expect(result?.isErr()).toBe(true);
      expect(result?.error.message).toContain(
        'The --overlay flag reads one lock overlay'
      );
    }
  });

  test('rejects --overlay against the live source', async () => {
    const navigate = unwrapCommands().find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate).toBeDefined();

    const result = await navigate?.execute(
      {},
      { overlay: 'cloudflare', source: 'live' },
      { cwd: process.cwd() }
    );

    expect(result?.isErr()).toBe(true);
    expect(result?.error.message).toContain('locked artifacts');
  });

  test('dispatches --overlay through the generic overlay read', async () => {
    const facts = fakeWayfindContext();
    const result = await wayfindTrail.implementation(
      parseWayfindInput({ overlay: 'cloudflare', rootDir: '/repo' }),
      facts.ctx
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(facts.calls).toEqual([
      {
        id: 'wayfind.overlay',
        input: { namespace: 'cloudflare', rootDir: '/repo' },
      },
    ]);
    expect(result.value).toMatchObject({
      result: { id: 'wayfind.overlay' },
      view: 'list',
    });
  });

  test('rejects target lookup mixed with population selector flags', async () => {
    const navigate = unwrapCommands().find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate).toBeDefined();

    const result = await navigate?.execute(
      { target: 'wayfind.search' },
      { errors: true },
      { cwd: process.cwd() }
    );

    expect(result?.isErr()).toBe(true);
    expect(result?.error.message).toContain(
      'Target lookup cannot be combined with population selector flags'
    );
  });

  test('normalizes target views, explicit patterns, and include facts', async () => {
    const target = fakeWayfindContext();
    const targetResult = await wayfindTrail.implementation(
      parseWayfindInput({ target: 'wayfind.search' }),
      target.ctx
    );
    expect(targetResult.isOk()).toBe(true);
    if (targetResult.isErr()) {
      throw targetResult.error;
    }
    expect(target.calls.map((call) => call.id)).toEqual(['wayfind.nearby']);
    expect(targetResult.value).toMatchObject({
      result: { id: 'wayfind.nearby' },
      target: 'wayfind.search',
      view: 'summary',
    });

    const glob = fakeWayfindContext();
    const globResult = await wayfindTrail.implementation(
      parseWayfindInput({ resolver: 'pattern', target: 'wayfind.*' }),
      glob.ctx
    );
    expect(globResult.isOk()).toBe(true);
    expect(glob.calls).toEqual([
      {
        id: 'wayfind.search',
        input: expect.objectContaining({ filters: { idGlob: 'wayfind.*' } }),
      },
    ]);

    const bareGlob = fakeWayfindContext();
    const bareGlobResult = await wayfindTrail.implementation(
      parseWayfindInput({ target: 'wayfind.*' }),
      bareGlob.ctx
    );
    expect(bareGlobResult.isErr()).toBe(true);
    expect(bareGlob.calls).toEqual([]);

    const barePathGlob = fakeWayfindContext();
    const barePathGlobResult = await wayfindTrail.implementation(
      parseWayfindInput({
        target: 'packages/*/src/index.ts',
        view: 'outline',
      }),
      barePathGlob.ctx
    );
    expect(barePathGlobResult.isErr()).toBe(true);
    expect(barePathGlob.calls).toEqual([]);

    const explicitFile = fakeWayfindContext();
    const explicitFileResult = await wayfindTrail.implementation(
      parseWayfindInput({
        resolver: 'file',
        target: 'apps/trails/src/app.ts',
        view: 'outline',
      }),
      explicitFile.ctx
    );
    expect(explicitFileResult.isOk()).toBe(true);
    expect(explicitFile.calls).toEqual([
      {
        id: 'wayfind.outline',
        input: expect.objectContaining({ file: 'apps/trails/src/app.ts' }),
      },
    ]);

    const outlineId = fakeWayfindContext();
    const outlineIdResult = await wayfindTrail.implementation(
      parseWayfindInput({
        target: 'wayfind.search',
        view: 'outline',
      }),
      outlineId.ctx
    );
    expect(outlineIdResult.isErr()).toBe(true);
    if (outlineIdResult.isOk()) {
      throw new Error('Expected outline view on a trail ID to fail');
    }
    expect(outlineIdResult.error.message).toContain(
      'outline view requires a source file path target'
    );
    expect(outlineId.calls).toEqual([]);

    const included = fakeWayfindContext();
    const includeResult = await wayfindTrail.implementation(
      parseWayfindInput({
        include: ['examples'],
        target: 'wayfind.search',
      }),
      included.ctx
    );
    expect(includeResult.isOk()).toBe(true);
    if (includeResult.isErr()) {
      throw includeResult.error;
    }
    expect(included.calls.map((call) => call.id)).toEqual([
      'wayfind.nearby',
      'wayfind.examples',
    ]);
    expect(includeResult.value.includes).toEqual({
      examples: {
        id: 'wayfind.examples',
        input: expect.objectContaining({
          filters: { id: 'wayfind.search' },
        }),
      },
    });

    const adapterInclude = fakeWayfindContext();
    const adapterIncludeResult = await wayfindTrail.implementation(
      parseWayfindInput({
        adapter: '@ontrails/hono',
        include: ['adapters'],
      }),
      adapterInclude.ctx
    );
    expect(adapterIncludeResult.isOk()).toBe(true);
    if (adapterIncludeResult.isErr()) {
      throw adapterIncludeResult.error;
    }
    expect(adapterInclude.calls).toEqual([
      {
        id: 'wayfind.adapters',
        input: expect.objectContaining({
          filters: { packageName: '@ontrails/hono' },
        }),
      },
      {
        id: 'wayfind.search',
        input: expect.objectContaining({
          filters: { surface: '__no_adapter_target__' },
        }),
      },
      {
        id: 'wayfind.adapters',
        input: expect.objectContaining({
          filters: { packageName: '@ontrails/hono' },
        }),
      },
    ]);
  });

  test('normalizes relation flags through target-bound impact', async () => {
    const deps = fakeWayfindContext();
    const depsResult = await wayfindTrail.implementation(
      parseWayfindInput({
        deps: true,
        resources: true,
        target: 'wayfind.search',
      }),
      deps.ctx
    );
    expect(depsResult.isOk()).toBe(true);
    expect(deps.calls).toEqual([
      {
        id: 'wayfind.impact',
        input: expect.objectContaining({
          direction: 'upstream',
          filters: { kind: 'resource' },
          id: 'wayfind.search',
        }),
      },
    ]);
  });

  test('routes secondary graph populations through the unified selector', async () => {
    for (const [flag, trailId, kind] of [
      ['entities', 'wayfind.entities', 'entity'],
      ['signals', 'wayfind.signals', 'signal'],
      ['trailheads', 'wayfind.trailheads', 'trailhead'],
    ] as const) {
      const context = fakeWayfindContext();
      const result = await wayfindTrail.implementation(
        parseWayfindInput({ [flag]: true }),
        context.ctx
      );

      expect(result.isOk()).toBe(true);
      expect(context.calls).toEqual([
        {
          id: trailId,
          input: expect.objectContaining({
            filters: { kind },
          }),
        },
      ]);
    }
  });

  test('exposes graph diff as the distinct two-root Wayfinder command', () => {
    const commands = unwrapCommands();
    const diff = commands.find(
      (command) => command.trail.id === 'wayfind.diff'
    );

    expect(diff?.path).toEqual(['wayfind', 'diff']);
    expect(diff?.flags.map((flag) => flag.name)).toEqual(
      expect.arrayContaining(['against-dir', 'against-root-dir', 'root-dir'])
    );
  });

  test('does not expose speculative Wayfinder queries on the CLI', () => {
    const commands = unwrapCommands();
    const trailIds = commands.map((command) => command.trail.id);

    expect(trailIds).not.toContain('wayfind.implications');
  });

  test('keeps the base operator topo separate from CLI Wayfinder exposure', () => {
    const defaultCommands = deriveCliCommands(operatorApp);
    if (defaultCommands.isErr()) {
      throw defaultCommands.error;
    }

    expect(
      defaultCommands.value.map((command) => command.trail.id)
    ).not.toContain('wayfind.overview');
    expect(operatorApp.get('wayfind.overview')).toBeUndefined();
    expect(operatorApp.get('wayfind.navigate')).toBeUndefined();
    expect(app.get('wayfind.overview')).toBeDefined();
    expect(app.get('wayfind.navigate')).toBeDefined();
  });

  test('renders outline text from structured fields', () => {
    const text = formatWayfindOutlineText({
      apps: [{ callee: 'topo', line: 20, name: 'app' }],
      counts: {
        apps: 1,
        declarations: 2,
        diagnostics: 1,
        graphMatches: 1,
        trails: 1,
      },
      diagnostics: [
        {
          code: 'graph.missing',
          message: 'No saved graph.',
          severity: 'warn',
        },
      ],
      features: {
        included: [
          'source',
          'trails',
          'apps',
          'graph',
          'contracts',
          'diagnostics',
        ],
        omitted: ['surfaces'],
        view: 'review',
      },
      file: 'src/app.ts',
      graph: {
        matchedTrailIds: ['user.create'],
        source: null,
      },
      rootDir: '/repo',
      source: {
        declarations: [
          { kind: 'const', line: 10, name: 'userCreateTrail' },
          { kind: 'const', line: 20, name: 'app' },
        ],
        exports: [],
        imports: [],
        lineCount: 20,
      },
      trails: [
        {
          contracts: { input: true, output: true },
          graph: { exampleCount: 1, intent: 'write', surfaces: ['cli'] },
          id: 'user.create',
          line: 10,
        },
      ],
    });

    expect(text).toContain('src/app.ts');
    expect(text).toContain('  graph matches: 1');
    expect(text).toContain(
      '  10: trail user.create (write, input+output, 1 example)'
    );
    expect(text).toContain('  20: app app (topo)');
    expect(text).toContain('  warn: graph.missing: No saved graph.');
  });
});
