import {
  createObservabilityAdapterConformanceCases,
  runConformance,
} from '@ontrails/observability/testing';

import { createLogtapeSink } from '../index.js';

runConformance(
  {
    createSink: createLogtapeSink,
    name: 'logtape',
  },
  createObservabilityAdapterConformanceCases()
);
