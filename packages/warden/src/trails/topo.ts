import { topo } from '@ontrails/core';

import * as rules from './index.js';

/** Topo collecting all warden rule trails. */
export const wardenTopo = topo('warden', rules);
