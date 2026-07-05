import { testAll } from '@ontrails/testing';

import { graph } from '../src/app.js';
import { operatorPermit } from '../src/permit.js';

// oxlint-disable-next-line require-hook -- testAll registers describe/test blocks at module level by design
testAll(graph, () => ({ permit: operatorPermit }));
