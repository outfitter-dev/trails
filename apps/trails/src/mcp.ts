#!/usr/bin/env bun
/* oxlint-disable eslint-plugin-jest/require-hook -- MCP stdio entrypoints execute at module scope */
import { surface } from '@ontrails/mcp';

import { trailsMcpApp } from './mcp-app.js';
import { trailsMcpSurfaceOptions } from './mcp-options.js';

await surface(trailsMcpApp, trailsMcpSurfaceOptions);
