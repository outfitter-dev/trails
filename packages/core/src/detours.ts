/**
 * Hard upper bound for detour recovery attempts.
 *
 * Execution and derived surface/topo facts both clamp declared detour
 * attempts to this value so runtime behavior and inspectable contracts stay in
 * lockstep.
 */
export const DETOUR_MAX_ATTEMPTS_CAP = 5;
