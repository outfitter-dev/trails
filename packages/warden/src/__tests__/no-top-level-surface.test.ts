import { describe, expect, test } from 'bun:test';

import { noTopLevelSurface } from '../rules/no-top-level-surface.js';

describe('no-top-level-surface', () => {
  test('flags top-level surface opening in a default topo export module', () => {
    const code = `
import { topo } from '@ontrails/core';
import { surface } from '@ontrails/mcp';
import * as trails from './trails';

const graph = topo('app', trails);
export default graph;
await surface(graph);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('no-top-level-surface');
    expect(diagnostics[0]?.severity).toBe('warn');
    expect(diagnostics[0]?.message).toContain('survey');
    expect(diagnostics[0]?.message).toContain('separate entry/bin');
  });

  test('flags top-level aliased surface opening in a named topo export module', () => {
    const code = `
import { topo } from '@ontrails/core';
import { surface as openMcp } from '@ontrails/mcp';
import * as trails from './trails';

export const graph = topo('app', trails);
await openMcp(graph);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
  });

  test('flags top-level connectStdio opening in a named topo export module', () => {
    const code = `
import { topo } from '@ontrails/core';
import { connectStdio } from '@ontrails/mcp';
import * as trails from './trails';

export const graph = topo('app', trails);
await connectStdio(server);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
  });

  test('flags top-level aliased startServer opening in a named topo export module', () => {
    const code = `
import { topo } from '@ontrails/core';
import { startServer as bootHttp } from '@ontrails/http/bun';
import * as trails from './trails';

export const graph = topo('app', trails);
await bootHttp(graph);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
  });

  test('flags namespace-imported surface opening in a named topo export module', () => {
    const code = `
import { topo } from '@ontrails/core';
import * as mcp from '@ontrails/mcp';
import * as trails from './trails';

const app = topo('app', trails);
export { app };
await mcp.surface(app);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
  });

  test('flags namespace-imported listen calls in a topo export module', () => {
    const code = `
import { topo } from '@ontrails/core';
import * as http from '@ontrails/http/bun';
import * as trails from './trails';

export const graph = topo('app', trails);
http.listen(graph);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
  });

  test('flags default-exported surface opening in a named topo export module', () => {
    const code = `
import { topo } from '@ontrails/core';
import { surface } from '@ontrails/mcp';
import * as trails from './trails';

export const graph = topo('app', trails);
export default await surface(graph);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(1);
  });

  test('ignores unrelated listen calls in a topo export module', () => {
    const code = `
import { topo } from '@ontrails/core';
import * as trails from './trails';

const server = { listen() {} };
export const graph = topo('app', trails);
server.listen(3000);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('allows surface opening in a dedicated surface module without topo export', () => {
    const code = `
import { surface } from '@ontrails/mcp';
import graph from './app';

await surface(graph);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/mcp.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('allows guarded or nested surface opening in a topo export module', () => {
    const code = `
import { topo } from '@ontrails/core';
import { surface } from '@ontrails/mcp';
import * as trails from './trails';

export const graph = topo('app', trails);

export const main = async () => {
  await surface(graph);
};

if (import.meta.main) {
  await main();
}
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('ignores unrelated local helpers named surface', () => {
    const code = `
import { topo } from '@ontrails/core';
import * as trails from './trails';

const surface = () => null;
export const graph = topo('app', trails);
surface();
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('allows create and derive helpers at module top level', () => {
    const code = `
import { topo } from '@ontrails/core';
import { createServer, deriveMcpTools } from '@ontrails/mcp';
import * as trails from './trails';

export const graph = topo('app', trails);
const tools = deriveMcpTools(graph);
const server = createServer(graph);
`;

    const diagnostics = noTopLevelSurface.check(code, 'src/app.ts');

    expect(diagnostics).toHaveLength(0);
  });
});
