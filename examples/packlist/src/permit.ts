/**
 * The local operator permit.
 *
 * Write and destroy trails declare a `packlist:write` scope requirement;
 * every surface entry point (and the test suite) injects this permit via
 * `createContext`, so permit governance holds without any auth UX — the
 * `junction` showcase owns the real permits story.
 */

export const operatorPermit = {
  id: 'packlist-operator',
  scopes: ['packlist:write'],
} as const;
