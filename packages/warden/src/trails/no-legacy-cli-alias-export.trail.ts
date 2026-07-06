import { noLegacyCliAliasExport } from '../rules/no-legacy-cli-alias-export.js';
import { wrapRule } from './wrap-rule.js';

export const noLegacyCliAliasExportTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'apps/example/src/app.ts',
        sourceCode: `import { surfaceOverlay } from '@ontrails/core';\n\nexport const trailsOverlays = [surfaceOverlay({ cli: { ls: 'gear.list' } })];\n`,
      },
      name: 'App modules binding CLI through trailsOverlays are clean',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'apps/example/src/app.ts',
            fix: {
              class: 'term-rewrite',
              reason:
                "Legacy CLI alias export 'trailsCliAliases' must be rewritten into a surfaceOverlay({ cli: { ... } }) entry inside the module's trailsOverlays array export; regrade class export-restructure (TRL-1210) will automate this restructure.",
              safety: 'review',
            },
            line: 1,
            message:
              "Legacy CLI alias export 'trailsCliAliases' was removed in the TRL-1207 surfaces-overlay cutover. Wrap the alias map into surfaceOverlay({ cli: { ... } }) from @ontrails/core inside the module's trailsOverlays array export.",
            rule: 'no-legacy-cli-alias-export',
            severity: 'error',
          },
        ],
      },
      input: {
        filePath: 'apps/example/src/app.ts',
        sourceCode: `export const trailsCliAliases = { 'gear.ls': [['gear', 'ls']] };\n`,
      },
      name: 'Legacy CLI alias exports produce migration diagnostics',
    },
  ],
  rule: noLegacyCliAliasExport,
});
