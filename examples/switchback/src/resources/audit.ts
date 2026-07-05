import { Result, resource } from '@ontrails/core';

import type { FlagValue } from '../model.js';

/**
 * One bootstrap payload served by `flag.evaluate-all`. Entries carry no
 * timestamp on purpose — the demo log stays clock-free so recorded content
 * is as deterministic as the evaluations themselves.
 */
export interface AuditEntry {
  readonly subjectId: string;
  readonly values: Readonly<Record<string, FlagValue>>;
}

/** Tiny in-memory eval log for the demo; nothing persists across processes. */
export interface AuditLog {
  record(entry: AuditEntry): void;
  list(): readonly AuditEntry[];
}

export const createAuditLog = (): AuditLog => {
  const entries: AuditEntry[] = [];
  return {
    list() {
      return [...entries];
    },
    record(entry) {
      entries.push(entry);
    },
  };
};

export const auditResource = resource('audit', {
  create: () => Result.ok(createAuditLog()),
  description:
    'In-memory demo log of bootstrap payloads served by flag.evaluate-all. Deliberately ephemeral.',
  mock: () => createAuditLog(),
});
