/**
 * Export-restructure class fixtures (TRL-1210).
 *
 * The fixtures quote the exact pre-TRL-1207-cutover corpus shapes from this
 * repo's history (commit d666837148b6eb6afb528650b4acd1d5b4141613, the last
 * state before the CLI cutover: `examples/packlist/bin/packlist.ts` and
 * `apps/trails/src/app.ts`) plus the examples/stash call-site trailhead map
 * as it stood before its module overlay landed, so the classes are proven
 * against the real migrations they automate.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { wardenRules } from '@ontrails/warden';

import {
  cliAliasesExportRestructureClass,
  createWardenExportRestructureClass,
  exportRestructureClasses,
  loadWardenRegradeClasses,
  mcpTrailheadsExportRestructureClass,
} from '../export-restructure.js';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..');

/** Verbatim `git show 'HEAD~3:examples/packlist/bin/packlist.ts'`. */
const preCutoverPacklistBin = `#!/usr/bin/env bun

/**
 * packlist CLI — commands, flags, aliases, help text, and exit codes all
 * derive from the trail contracts in \`src/app.ts\`.
 *
 * The injected context carries the local operator permit (no auth UX in
 * this showcase — \`junction\` owns the permits story) and a stderr logger so
 * signal consumers like \`pack.recalculate\` are visible in normal output.
 */

import { createTrailContext } from '@ontrails/core';
import { surface } from '@ontrails/commander';

import { graph } from '../src/app.js';
import { createStderrLogger } from '../src/logger.js';
import { operatorPermit } from '../src/permit.js';

/**
 * Surface-owned CLI aliases, kept here (not exported from \`src/app.ts\`)
 * because \`trails compile\` embeds app-module aliases into the lock graph
 * while Warden's drift check derives the fresh graph without them, which
 * would report the committed lock as permanently stale.
 *
 * TODO ::: trails-gap: warden drift ignores cliAliases that compile embeds,
 * so alias-exporting app modules never pass the drift check. Open as
 * TRL-1179; move the aliases back to \`src/app.ts\` once it lands.
 */
const cliAliases = {
  'gear.create': [['gear', 'add']],
  'gear.list': [['gear', 'ls']],
  'gear.read': [['gear', 'get']],
  'pack.list': [['pack', 'ls']],
  'pack.read': [['pack', 'get']],
  'trip.list': [['trip', 'ls']],
  'trip.read': [['trip', 'get']],
} as const;

// oxlint-disable-next-line require-hook -- CLI entry point, not a test file
await surface(graph, {
  aliases: cliAliases,
  createContext: () =>
    createTrailContext({
      logger: createStderrLogger(),
      permit: operatorPermit,
    }),
});
`;

/**
 * The `git show 'HEAD~3:apps/trails/src/app.ts'` legacy export, quoted with
 * its exact surrounding statements (the core import on line 1 and the topo
 * export that followed the alias map).
 */
const preCutoverTrailsAppModule = `import { topo } from '@ontrails/core';

export const trailsCliAliases = {
  'survey.diff': [['diff']],
} as const;

export const app = topo('trails', operatorTrails, cliWayfinderTrails);
`;

/**
 * Verbatim examples/stash/src/mcp-options.ts before the module overlay
 * landed: the trailhead map lives only at the call site.
 */
const preCutoverStashMcpOptions = `/**
 * MCP surface options — the hero surface.
 *
 * Trailheads group the dense topo into four entries an agent can scan in one
 * tool listing. A trailhead call is \`{ trail, input }\` and the response
 * carries \`{ trail, output }\`: member trail identity is preserved at
 * invocation and response time (ADR-0050), never merged away.
 */

import type {
  CreateServerOptions,
  McpSurfaceTrailheadMap,
} from '@ontrails/mcp';

export const stashTrailheads = {
  account: {
    description:
      'Token self-service and identity: mint, list, and revoke API tokens; check who a token belongs to.',
    trails: ['token.create', 'token.list', 'token.revoke', 'user.me'],
  },
  history: {
    description:
      'Immutable revision history: list revisions, read one in full, diff two seqs, fetch raw file bytes.',
    trails: ['revision.list', 'revision.get', 'revision.diff', 'file.raw'],
  },
  search: {
    description:
      'Keyword search over the signal-maintained index of public snippets.',
    trails: ['search.query'],
  },
  snippets: {
    description:
      'Create, read, update, fork, star, and delete snippets. Updates append revisions; secret snippets are owner-only.',
    trails: [
      'snippet.create',
      'snippet.get',
      'snippet.list',
      'snippet.update',
      'snippet.delete',
      'snippet.fork',
      'snippet.star',
      'snippet.unstar',
    ],
  },
} satisfies McpSurfaceTrailheadMap;

export const stashMcpOptions = {
  description:
    'Self-hosted gists for agents: save, search, fork, and retrieve snippets with immutable revision history.',
  name: 'stash',
  trailheads: stashTrailheads,
  version: '0.1.0',
} satisfies CreateServerOptions;
`;

const packlistInvertedBindings: readonly (readonly [string, string])[] = [
  ['gear.add', 'gear.create'],
  ['gear.get', 'gear.read'],
  ['gear.ls', 'gear.list'],
  ['pack.get', 'pack.read'],
  ['pack.ls', 'pack.list'],
  ['trip.get', 'trip.read'],
  ['trip.ls', 'trip.list'],
];

describe('cliAliasesExportRestructureClass', () => {
  test('routes the pre-cutover packlist bin const to review naming the inverted target', () => {
    const result = cliAliasesExportRestructureClass.apply(
      preCutoverPacklistBin,
      { path: 'examples/packlist/bin/packlist.ts' }
    );

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('cli-aliases-referenced-in-module');
    const detail = result.reviewDetails?.[0];
    expect(detail?.symbol).toBe('cliAliases');
    for (const [alias, trailId] of packlistInvertedBindings) {
      expect(detail?.expectedTarget).toContain(`'${alias}': '${trailId}'`);
    }
    expect(detail?.expectedTarget).toContain('surfaceOverlay({ cli: {');
    expect(detail?.expectedTarget).toContain('trailsOverlays');
  });

  test('the reviewed packlist target is exactly what the migrated app module authors today', () => {
    const currentApp = readFileSync(
      join(repoRoot, 'examples', 'packlist', 'src', 'app.ts'),
      'utf8'
    );
    for (const [alias, trailId] of packlistInvertedBindings) {
      expect(currentApp).toContain(`'${alias}': '${trailId}',`);
    }
    expect(currentApp).toContain('export const trailsOverlays = [');
    expect(currentApp).toContain('surfaceOverlay({');
  });

  test('rewrites the pre-cutover trails app trailsCliAliases export into trailsOverlays', () => {
    const result = cliAliasesExportRestructureClass.apply(
      preCutoverTrailsAppModule,
      { path: 'apps/trails/src/app.ts' }
    );

    expect(result.kind).toBe('rewrite');
    const next = result.nextSource ?? '';
    expect(next).toContain(
      "import { surfaceOverlay, topo } from '@ontrails/core';"
    );
    expect(next).toContain('export const trailsOverlays = [');
    expect(next).toContain('surfaceOverlay({');
    expect(next).toContain("diff: 'survey.diff',");
    expect(next).not.toContain('trailsCliAliases');

    // The migrated apps/trails app module authors the same binding today.
    const currentApp = readFileSync(
      join(repoRoot, 'apps', 'trails', 'src', 'app.ts'),
      'utf8'
    );
    expect(currentApp).toContain("cli: { diff: 'survey.diff' }");
  });

  test('is idempotent: a rewritten module and the migrated corpus are no-ops', () => {
    const rewritten = cliAliasesExportRestructureClass.apply(
      preCutoverTrailsAppModule,
      { path: 'apps/trails/src/app.ts' }
    );
    expect(rewritten.kind).toBe('rewrite');
    const again = cliAliasesExportRestructureClass.apply(
      rewritten.nextSource ?? '',
      { path: 'apps/trails/src/app.ts' }
    );
    expect(again.kind).toBe('no-op');

    const currentPacklistApp = readFileSync(
      join(repoRoot, 'examples', 'packlist', 'src', 'app.ts'),
      'utf8'
    );
    const corpus = cliAliasesExportRestructureClass.apply(currentPacklistApp, {
      path: 'examples/packlist/src/app.ts',
    });
    expect(corpus.kind).toBe('no-op');
  });

  test('merges inverted bindings into an existing surfaceOverlay element', () => {
    const module = [
      "import { surfaceOverlay, topo } from '@ontrails/core';",
      '',
      'export const trailsOverlays = [',
      '  surfaceOverlay({',
      '    mcp: {',
      "      inspect: ['survey', 'topo'],",
      '    },',
      '  }),',
      '];',
      '',
      'export const cliAliases = {',
      "  'gear.list': [['gear', 'ls']],",
      '} as const;',
      '',
    ].join('\n');

    const result = cliAliasesExportRestructureClass.apply(module, {
      path: 'apps/example/src/app.ts',
    });
    expect(result.kind).toBe('rewrite');
    const next = result.nextSource ?? '';
    expect(next).toContain("cli: {\n      'gear.ls': 'gear.list',\n    },");
    expect(next).toContain('mcp: {');
    expect(next).not.toContain('cliAliases');

    const again = cliAliasesExportRestructureClass.apply(next, {
      path: 'apps/example/src/app.ts',
    });
    expect(again.kind).toBe('no-op');
  });

  test('appending to a trailing-comma array emits no sparse-array hole', () => {
    const module = [
      "import { lockOverlay } from './overlays.js';",
      '',
      'export const trailsOverlays = [',
      '  lockOverlay(),',
      '];',
      '',
      'export const cliAliases = {',
      "  'gear.list': [['gear', 'ls']],",
      '} as const;',
      '',
    ].join('\n');

    const result = cliAliasesExportRestructureClass.apply(module, {
      path: 'apps/example/src/app.ts',
    });
    expect(result.kind).toBe('rewrite');
    const next = result.nextSource ?? '';
    expect(next).toContain('surfaceOverlay({');
    expect(next).not.toContain('}),,');
    expect(next).not.toMatch(/,\s*,/);

    const again = cliAliasesExportRestructureClass.apply(next, {
      path: 'apps/example/src/app.ts',
    });
    expect(again.kind).toBe('no-op');
  });

  test('routes computed keys and spreads to review instead of guessing', () => {
    const computed = cliAliasesExportRestructureClass.apply(
      [
        "const key = 'gear.list';",
        "export const cliAliases = { [key]: [['gear', 'ls']] };",
        '',
      ].join('\n'),
      { path: 'apps/example/src/app.ts' }
    );
    expect(computed.kind).toBe('needs-review');
    expect(computed.reason).toBe('cli-aliases-not-statically-provable');

    const spread = cliAliasesExportRestructureClass.apply(
      [
        "import { shared } from './shared.js';",
        'export const trailsCliAliases = { ...shared };',
        '',
      ].join('\n'),
      { path: 'apps/example/src/app.ts' }
    );
    expect(spread.kind).toBe('needs-review');
    expect(spread.reason).toBe('cli-aliases-not-statically-provable');
    expect(spread.reviewDetails?.[0]?.expectedTarget).toContain(
      'surfaceOverlay({ cli:'
    );
  });

  test('skips files outside the Warden source scan target', () => {
    const result = cliAliasesExportRestructureClass.apply(
      'export const cliAliases = {};',
      { path: 'apps/example/src/__tests__/app.test.ts' }
    );
    expect(result.kind).toBe('skipped');
  });
});

describe('mcpTrailheadsExportRestructureClass', () => {
  test('routes the pre-cutover stash call-site map to review naming the mcp target shape', () => {
    const result = mcpTrailheadsExportRestructureClass.apply(
      preCutoverStashMcpOptions,
      { path: 'examples/stash/src/mcp-options.ts' }
    );

    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('mcp-trailheads-module-overlay-missing');
    const detail = result.reviewDetails?.[0];
    expect(detail?.symbol).toBe('stashTrailheads');
    expect(detail?.expectedTarget).toContain('surfaceOverlay({ mcp: {');
    expect(detail?.expectedTarget).toContain(
      "account: ['token.create', 'token.list', 'token.revoke', 'user.me']"
    );
    expect(detail?.expectedTarget).toContain(
      "history: ['revision.list', 'revision.get', 'revision.diff', 'file.raw']"
    );
    expect(detail?.expectedTarget).toContain("search: ['search.query']");
    expect(detail?.expectedTarget).toContain(
      "snippets: ['snippet.create', 'snippet.get', 'snippet.list', 'snippet.update', 'snippet.delete', 'snippet.fork', 'snippet.star', 'snippet.unstar']"
    );
    expect(detail?.expectedTarget).toContain(
      'keep this call-site trailhead map as the runtime override-in-context'
    );
  });

  test('treats a call-site map that already threads trailsOverlays as migrated', () => {
    const migrated = preCutoverStashMcpOptions
      .replace(
        "} from '@ontrails/mcp';",
        "} from '@ontrails/mcp';\n\nimport { trailsOverlays } from './app.js';"
      )
      .replace(
        "  name: 'stash',",
        "  name: 'stash',\n  overlays: trailsOverlays,"
      );
    const result = mcpTrailheadsExportRestructureClass.apply(migrated, {
      path: 'examples/stash/src/mcp-options.ts',
    });
    expect(result.kind).toBe('no-op');
    expect(result.notes.join(' ')).toContain('override-in-context');
  });

  test('rewrites in place when the same module exports trailsOverlays', () => {
    const module = [
      "import { surfaceOverlay, topo } from '@ontrails/core';",
      '',
      'export const trailsOverlays = [',
      '  surfaceOverlay({',
      "    cli: { ls: 'gear.list' },",
      '  }),',
      '];',
      '',
      'export const gearTrailheads = {',
      '  gear: {',
      "    description: 'Gear management.',",
      "    trails: ['gear.create', 'gear.list'],",
      '  },',
      '};',
      '',
    ].join('\n');

    const result = mcpTrailheadsExportRestructureClass.apply(module, {
      path: 'apps/example/src/app.ts',
    });
    expect(result.kind).toBe('rewrite');
    const next = result.nextSource ?? '';
    expect(next).toContain(
      "mcp: {\n      gear: ['gear.create', 'gear.list'],\n    },"
    );
    // The call-site map survives as the richer-metadata override.
    expect(next).toContain('export const gearTrailheads = {');

    const again = mcpTrailheadsExportRestructureClass.apply(next, {
      path: 'apps/example/src/app.ts',
    });
    expect(again.kind).toBe('no-op');
  });

  test('appending to a trailing-comma array without a surfaceOverlay emits no sparse-array hole', () => {
    const module = [
      "import { lockOverlay } from './overlays.js';",
      '',
      'export const trailsOverlays = [',
      '  lockOverlay(),',
      '];',
      '',
      'export const gearTrailheads = {',
      '  gear: {',
      "    description: 'Gear management.',",
      "    trails: ['gear.create', 'gear.list'],",
      '  },',
      '};',
      '',
    ].join('\n');

    const result = mcpTrailheadsExportRestructureClass.apply(module, {
      path: 'apps/example/src/app.ts',
    });
    expect(result.kind).toBe('rewrite');
    const next = result.nextSource ?? '';
    expect(next).toContain('surfaceOverlay({');
    expect(next).not.toContain('}),,');
    expect(next).not.toMatch(/,\s*,/);

    const again = mcpTrailheadsExportRestructureClass.apply(next, {
      path: 'apps/example/src/app.ts',
    });
    expect(again.kind).toBe('no-op');
  });

  test('ignores helper functions and values that merely share the naming suffix', () => {
    const helpers = [
      'export const diffTrailheads = (graph: unknown): string[] => [];',
      '',
      'const hasTrailheadMapTypeAnnotation = (source: string): boolean =>',
      '  /\\b(?:McpSurfaceTrailheadMap|TrailheadMap)\\b/.test(source);',
      '',
      "export const trailheadDescriptions = { snippets: 'Snippet tools.' };",
      '',
    ].join('\n');
    const result = mcpTrailheadsExportRestructureClass.apply(helpers, {
      path: 'packages/example/src/diff.ts',
    });
    expect(result.kind).toBe('no-op');
  });

  test('routes an explicitly typed dynamic map to review', () => {
    const module = [
      "import type { McpSurfaceTrailheadMap } from '@ontrails/mcp';",
      "import { buildTrailheads } from './shared.js';",
      '',
      'export const trailheads: McpSurfaceTrailheadMap = buildTrailheads();',
      '',
    ].join('\n');
    const result = mcpTrailheadsExportRestructureClass.apply(module, {
      path: 'apps/example/src/mcp-options.ts',
    });
    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('mcp-trailheads-not-statically-provable');
  });

  test('routes dynamic trails selectors to review', () => {
    const module = [
      "import { sharedTrails } from './shared.js';",
      '',
      'export const gearTrailheads = {',
      "  gear: { description: 'Gear.', trails: sharedTrails },",
      '};',
      '',
    ].join('\n');
    const result = mcpTrailheadsExportRestructureClass.apply(module, {
      path: 'apps/example/src/mcp-options.ts',
    });
    expect(result.kind).toBe('needs-review');
    expect(result.reason).toBe('mcp-trailheads-not-statically-provable');
  });
});

describe('warden export-restructure discovery', () => {
  test('maps the no-legacy-cli-alias-export rule to the cli-aliases class', () => {
    const rule = wardenRules.get('no-legacy-cli-alias-export');
    expect(rule).toBeDefined();
    if (rule === undefined) {
      return;
    }
    expect(createWardenExportRestructureClass(rule)).toBe(
      cliAliasesExportRestructureClass
    );
  });

  test('loadWardenRegradeClasses yields term-rewrite and export-restructure classes', async () => {
    const { classes, diagnostics } = await loadWardenRegradeClasses();
    expect(diagnostics).toEqual([]);
    const ids = classes.map((cls) => cls.id);
    expect(ids).toContain('export-restructure:cli-aliases');
    expect(ids).toContain('export-restructure:mcp-trailheads');
    expect(ids).toContain('term-rewrite:no-legacy-layer-imports');
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the family is exported in deterministic id order', () => {
    expect(exportRestructureClasses.map((cls) => cls.id)).toEqual([
      'export-restructure:cli-aliases',
      'export-restructure:mcp-trailheads',
    ]);
  });
});
