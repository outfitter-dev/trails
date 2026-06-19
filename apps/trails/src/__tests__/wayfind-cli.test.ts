import { deriveCliCommands } from '@ontrails/cli';
import { describe, expect, test } from 'bun:test';

import {
  app,
  operatorApp,
  trailsCliAliases,
  trailsCliIncludedTrails,
} from '../app.js';
import { formatWayfindOutlineText } from '../run-wayfind-outline.js';

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
      expect.arrayContaining(['around', 'depth', 'from', 'module', 'to'])
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
