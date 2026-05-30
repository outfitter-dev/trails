// Root package surface for `@ontrails/regrade`.
//
// Only the runnable graph and its public parent trail are exported here. The
// internal child transform trail stays reachable through the topo and the
// parent's `composes` declaration. The transform schemas remain internal
// package test harness details until Regrade has a deliberate public contract.
export {
  literalRegradeTopo,
  literalRegradeTrail,
} from './literal-transform.js';
