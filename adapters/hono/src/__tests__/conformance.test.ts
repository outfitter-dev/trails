import { afterEach, beforeEach, mock } from 'bun:test';
import {
  createHttpAdapterConformanceCases,
  runConformance,
} from '@ontrails/http/testing';
import type { HttpAdapterConformanceAdapter } from '@ontrails/http/testing';

import { createApp } from '../surface.js';

const honoAdapter = {
  createApp,
  name: '@ontrails/hono',
} satisfies HttpAdapterConformanceAdapter;

let originalConsoleError = console.error;

beforeEach(() => {
  originalConsoleError = console.error;
  console.error = mock(() => {});
});

afterEach(() => {
  console.error = originalConsoleError;
});

runConformance(honoAdapter, createHttpAdapterConformanceCases());
