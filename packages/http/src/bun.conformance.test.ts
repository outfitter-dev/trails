import {
  createHttpAdapterConformanceCases,
  runConformance,
} from '@ontrails/http/testing';
import type { HttpAdapterConformanceAdapter } from '@ontrails/http/testing';

import { createApp } from './bun.js';

const bunAdapter = {
  createApp,
  name: '@ontrails/http/bun',
} satisfies HttpAdapterConformanceAdapter;

runConformance(bunAdapter, createHttpAdapterConformanceCases());
