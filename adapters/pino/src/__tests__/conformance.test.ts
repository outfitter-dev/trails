import {
  createObservabilityAdapterConformanceCases,
  runConformance,
} from '@ontrails/observability/testing';

import { createPinoSink } from '../index.js';

runConformance(
  {
    createSink: () => createPinoSink({ pinoOptions: { level: 'silent' } }),
    name: 'pino',
  },
  createObservabilityAdapterConformanceCases()
);
