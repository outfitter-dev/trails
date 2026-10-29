import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { surface } from '../../surface.js';

const echo = trail('echo', {
  implementation: (input) => {
    process.emitWarning('MCP invocation warning', { code: 'TRL1433_CALL' });
    return Result.ok(input);
  },
  input: z.object({ text: z.string() }),
  intent: 'read',
  output: z.object({ text: z.string() }),
});

await surface(topo('stdio-warning', { echo }), { mcpResources: false });
process.emitWarning('MCP startup warning', { code: 'TRL1433_START' });
