import { afterEach, beforeEach, mock } from 'bun:test';
import {
  createHttpAdapterConformanceCases,
  runConformance,
} from '@ontrails/http/testing';
import type { HttpAdapterConformanceAdapter } from '@ontrails/http/testing';

import { createWorkersHandler } from '../index.js';

const workersAdapter = {
  createApp: (graph, options) => {
    const worker = createWorkersHandler(graph, options);
    return {
      fetch: async (request: Request) => await worker.fetch(request, {}),
    };
  },
  name: '@ontrails/cloudflare/workers',
} satisfies HttpAdapterConformanceAdapter;

let originalConsoleError = console.error;

beforeEach(() => {
  originalConsoleError = console.error;
  console.error = mock(() => {});
});

afterEach(() => {
  console.error = originalConsoleError;
});

runConformance(workersAdapter, createHttpAdapterConformanceCases());
