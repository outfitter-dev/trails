/**
 * The fixture topo, assembled. Imports the trail/resource/signal namespace and
 * registers it under one topo, mirroring the scaffold's `topo(name, ...modules)`
 * shape. Rendering and parity tests derive against `fixtureApp`.
 */
import { topo } from '@ontrails/core';

import * as trails from './trails.js';

export const fixtureApp = topo('library-fixture', trails);
