import { deriveCliCommands } from '@ontrails/cli';
import { Result } from '@ontrails/core';
import { describe, expect, test } from 'bun:test';

import {
  app,
  operatorApp,
  trailsCliAliases,
  trailsCliIncludedTrails,
} from '../app.js';
import { formatWayfindOutlineText } from '../run-wayfind-outline.js';
import { wayfindTrail } from '../trails/wayfind.js';

const unwrapCommands = () => {
  const result = deriveCliCommands(app, {
    aliases: trailsCliAliases,
    include: trailsCliIncludedTrails,
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const parseWayfindInput = (input: Record<string, unknown>) =>
  wayfindTrail.input.parse(input);

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
    expect(commandPaths).toContain('wayfind overview');
    expect(commandPaths).toContain('wayfind adapters');
    expect(commandPaths).toContain('wayfind search');
    expect(commandPaths).toContain('wayfind trails');
    expect(commandPaths).toContain('wayfind contract');
    expect(commandPaths).toContain('wayfind describe');
    expect(commandPaths).toContain('wayfind diff');
    expect(commandPaths).toContain('wayfind errors');
    expect(commandPaths).toContain('wayfind nearby');
    expect(commandPaths).toContain('wayfind impact');
    expect(commandPaths).toContain('wayfind examples');
    expect(commandPaths).toContain('wayfind outline');

    expect(trailIds).toContain('wayfind.navigate');
    expect(trailIds).toContain('wayfind.overview');
    expect(trailIds).toContain('wayfind.adapters');
    expect(trailIds).toContain('wayfind.search');
    expect(trailIds).toContain('wayfind.trails');
    expect(trailIds).toContain('wayfind.contract');
    expect(trailIds).toContain('wayfind.describe');
    expect(trailIds).toContain('wayfind.diff');
    expect(trailIds).toContain('wayfind.errors');
    expect(trailIds).toContain('wayfind.nearby');
    expect(trailIds).toContain('wayfind.impact');
    expect(trailIds).toContain('wayfind.examples');
    expect(trailIds).toContain('wayfind.outline');

    const outline = commands.find(
      (command) => command.trail.id === 'wayfind.outline'
    );
    expect(outline?.args.map((arg) => arg.name)).toEqual(['file']);

    const navigate = commands.find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate?.args.map((arg) => arg.name)).toEqual(['target']);
    expect(navigate?.flags.map((flag) => flag.name)).toEqual(
      expect.arrayContaining([
        'adapter',
        'adapters',
        'around',
        'depth',
        'errors',
        'from',
        'include',
        'module',
        'to',
      ])
    );
    expect(navigate?.routes).toEqual([
      {
        kind: 'canonical',
        path: ['wayfind'],
        source: 'trail',
        target: 'wayfind.navigate',
      },
    ]);

    const search = commands.find(
      (command) => command.trail.id === 'wayfind.search'
    );
    expect(search?.routes).toEqual([
      {
        kind: 'canonical',
        path: ['wayfind', 'search'],
        source: 'derived',
        target: 'wayfind.search',
      },
    ]);
  });

  test('guards against ambiguous relational wayfind targets', async () => {
    const navigate = unwrapCommands().find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate).toBeDefined();

    const result = await navigate?.execute(
      { target: 'wayfind.search' },
      { from: 'db.main' },
      { cwd: process.cwd() }
    );

    expect(result?.isErr()).toBe(true);
    expect(result?.error.message).toContain(
      'Provide only one of target, from, to, or around.'
    );
  });

  test('guards live source against unsupported relational views', async () => {
    const navigate = unwrapCommands().find(
      (command) => command.trail.id === 'wayfind.navigate'
    );
    expect(navigate).toBeDefined();

    const result = await navigate?.execute(
      {},
      { from: 'db.main', source: 'live' },
      { cwd: process.cwd() }
    );

    expect(result?.isErr()).toBe(true);
    expect(result?.error.message).toContain('supports overview and ID lookup');
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
      { from: 'wayfind.search', include: ['examples'] },
      { cwd: process.cwd() }
    );
    expect(relation?.isErr()).toBe(true);
    expect(relation?.error.message).toContain(
      '--include attaches facts to a target or filtered population'
    );
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

  test('normalizes target views, glob targets, and include facts', async () => {
    const target = fakeWayfindContext();
    const targetResult = await wayfindTrail.blaze(
      parseWayfindInput({ target: 'wayfind.search' }),
      target.ctx
    );
    expect(targetResult.isOk()).toBe(true);
    if (targetResult.isErr()) {
      throw targetResult.error;
    }
    expect(target.calls.map((call) => call.id)).toEqual(['wayfind.describe']);
    expect(targetResult.value).toMatchObject({
      result: { id: 'wayfind.describe' },
      target: 'wayfind.search',
      view: 'describe',
    });

    const glob = fakeWayfindContext();
    const globResult = await wayfindTrail.blaze(
      parseWayfindInput({ target: 'wayfind.*' }),
      glob.ctx
    );
    expect(globResult.isOk()).toBe(true);
    expect(glob.calls).toEqual([
      {
        id: 'wayfind.search',
        input: expect.objectContaining({ filters: { idGlob: 'wayfind.*' } }),
      },
    ]);

    const outlineGlob = fakeWayfindContext();
    const outlineGlobResult = await wayfindTrail.blaze(
      parseWayfindInput({
        target: 'packages/*/src/index.ts',
        view: 'outline',
      }),
      outlineGlob.ctx
    );
    expect(outlineGlobResult.isOk()).toBe(true);
    expect(outlineGlob.calls).toEqual([
      {
        id: 'wayfind.outline',
        input: expect.objectContaining({ file: 'packages/*/src/index.ts' }),
      },
    ]);

    const included = fakeWayfindContext();
    const includeResult = await wayfindTrail.blaze(
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
      'wayfind.describe',
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

    expect(trailIds).not.toContain('wayfind.query');
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
