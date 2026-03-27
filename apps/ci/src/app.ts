import { topo } from '@ontrails/core';

import * as ciDrift from './trails/ci-drift.js';
import * as ciWarden from './trails/ci-warden.js';

export const app = topo('ci', ciWarden, ciDrift);
