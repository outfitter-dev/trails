import { noTopLevelSurface } from '../rules/no-top-level-surface.js';
import { wrapRule } from './wrap-rule.js';

export const noTopLevelSurfaceTrail = wrapRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        filePath: 'src/mcp.ts',
        sourceCode: `import { surface } from "@ontrails/mcp";
import graph from "./app";

await surface(graph);`,
      },
      name: 'Allows dedicated surface entry modules',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: 'src/app.ts',
            line: 6,
            message:
              'This module exports a topo and opens a surface at module top level. Trails introspection commands (`survey`, `guide`, `compile`) import topo entry modules, so opening a surface here can trigger sockets or transports during introspection. Move surface-opening to a separate entry/bin and keep the topo-export module side-effect-free.',
            rule: 'no-top-level-surface',
            severity: 'warn',
          },
        ],
      },
      input: {
        filePath: 'src/app.ts',
        sourceCode: `import { topo } from "@ontrails/core";
import { surface } from "@ontrails/mcp";
import * as trails from "./trails";

export const graph = topo("app", trails);
await surface(graph);`,
      },
      name: 'Warns when a topo export module opens a surface',
    },
  ],
  rule: noTopLevelSurface,
});
