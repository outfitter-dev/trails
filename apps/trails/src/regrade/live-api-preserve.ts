import { Result, ValidationError, escapeRegExp } from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import type {
  VocabularyPreserveInventoryEntry,
  VocabularyRegradePlan,
} from '@ontrails/regrade';
import { deriveVocabularyFormProposals } from '@ontrails/regrade';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const lockShapeSchema = z
  .object({
    topoGraph: z
      .object({
        entries: z.array(z.object({ id: z.string() }).passthrough()),
        library: z
          .object({
            exports: z.array(
              z.object({ exportName: z.string() }).passthrough()
            ),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

type LockShape = z.output<typeof lockShapeSchema>;

const liveApiValues = (
  lock: LockShape
): readonly {
  readonly evidence: string;
  readonly value: string;
}[] => {
  const values = new Map<string, string>();
  for (const entry of lock.topoGraph?.entries ?? []) {
    if (typeof entry.id === 'string') {
      values.set(entry.id, `topo.entry:${entry.id}`);
    }
  }
  for (const item of lock.topoGraph?.library?.exports ?? []) {
    if (typeof item.exportName === 'string') {
      values.set(item.exportName, `topo.library:${item.exportName}`);
    }
  }
  return [...values.entries()]
    .map(([value, evidence]) => ({ evidence, value }))
    .toSorted((left, right) => left.value.localeCompare(right.value));
};

const identifierSegments = (value: string): readonly string[] =>
  value
    .split(/[^A-Za-z0-9]+/u)
    .flatMap(
      (part) => part.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/gu) ?? []
    );

const liveApiValueContainsSource = (value: string, source: string): boolean => {
  if (/^[A-Za-z][A-Za-z0-9]*$/u.test(source)) {
    const normalized = source.toLowerCase();
    return identifierSegments(value).some(
      (segment) => segment.toLowerCase() === normalized
    );
  }
  return new RegExp(
    `(?<![A-Za-z0-9_$])${escapeRegExp(source)}(?![A-Za-z0-9_$])`,
    'iu'
  ).test(value);
};

export const deriveLiveApiPreserveInventory = async (
  plan: VocabularyRegradePlan,
  rootDir = process.cwd()
): Promise<
  TrailsResult<readonly VocabularyPreserveInventoryEntry[], ValidationError>
> => {
  const lockPath = join(rootDir, 'trails.lock');
  if (!existsSync(lockPath)) {
    return Result.ok([]);
  }
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    return Result.err(
      new ValidationError(
        'Unable to parse trails.lock for live API preserves.',
        {
          ...(error instanceof Error ? { cause: error } : {}),
          context: { path: lockPath },
        }
      )
    );
  }
  const parsed = lockShapeSchema.safeParse(input);
  if (!parsed.success) {
    return Result.err(
      new ValidationError(
        'trails.lock does not contain a compatible TopoGraph for live API preserves.',
        { context: { issues: parsed.error.issues, path: lockPath } }
      )
    );
  }
  const sourceForms = deriveVocabularyFormProposals(plan).map(
    (proposal) => proposal.from
  );
  return Result.ok(
    liveApiValues(parsed.data)
      .filter(({ value }) =>
        sourceForms.some((source) => liveApiValueContainsSource(value, source))
      )
      .map(({ evidence, value }) => ({
        disposition: 'preserve-current-live-api' as const,
        evidence: [evidence],
        pattern: escapeRegExp(value),
        reason: 'current-live-topo-api',
        source: 'derived-live-api' as const,
      }))
  );
};
