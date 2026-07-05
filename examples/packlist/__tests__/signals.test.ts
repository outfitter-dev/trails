/**
 * Proves the reactive loop end to end against the mocked store:
 * gear.update fires pack.weight-stale, pack.recalculate consumes it,
 * recomputes the affected pack, and logs the fresh total (which is what the
 * CLI surfaces to the operator).
 */

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';
import type { Logger } from '@ontrails/core';

import { graph } from '../src/app.js';
import { db } from '../src/resources/db.js';
import { operatorPermit } from '../src/permit.js';

interface CapturedLine {
  readonly data: Record<string, unknown> | undefined;
  readonly level: string;
  readonly message: string;
}

const createCapturingLogger = (
  lines: CapturedLine[],
  context: Record<string, unknown> = {}
): Logger => {
  const capture =
    (level: string) =>
    (message: string, data?: Record<string, unknown>): void => {
      lines.push({ data, level, message });
    };
  return {
    child: (childContext) =>
      createCapturingLogger(lines, { ...context, ...childContext }),
    debug: capture('debug'),
    error: capture('error'),
    fatal: capture('fatal'),
    info: capture('info'),
    trace: capture('trace'),
    warn: capture('warn'),
  };
};

const createMockConnection = async () => {
  if (db.mock === undefined) {
    throw new Error('packlist db resource must declare a mock factory');
  }
  return await db.mock();
};

describe('gear weight change → pack recalculation', () => {
  test('gear.update fires pack.weight-stale and the consumer recomputes the pack', async () => {
    const connection = await createMockConnection();
    const lines: CapturedLine[] = [];
    const result = await run(
      graph,
      'gear.update',
      { id: 'gear-stove', weightGrams: 300 },
      {
        ctx: {
          extensions: { db: connection },
          logger: createCapturingLogger(lines),
          permit: operatorPermit,
        },
      }
    );

    expect(result.isOk()).toBe(true);

    // The consumer recomputed Weekend Loop with the new stove weight:
    // tent 1800 g + stove 300 g = 2100 g.
    const recalcLine = lines.find(
      (line) =>
        line.level === 'info' && line.message.includes('recalculated: 2100 g')
    );
    expect(recalcLine).toBeDefined();
    expect(recalcLine?.message).toContain('Weekend Loop');
    expect(recalcLine?.message).toContain('220 g → 300 g');
    expect(recalcLine?.data).toEqual({ packId: 'pack-weekend' });
  });

  test('weight changes to gear no pack carries stay silent', async () => {
    const connection = await createMockConnection();
    const lines: CapturedLine[] = [];
    const result = await run(
      graph,
      'gear.update',
      { id: 'gear-bearcan', weightGrams: 900 },
      {
        ctx: {
          extensions: { db: connection },
          logger: createCapturingLogger(lines),
          permit: operatorPermit,
        },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      lines.filter((line) => line.message.includes('recalculated'))
    ).toHaveLength(0);
  });

  test('non-weight updates do not fire the stale signal', async () => {
    const connection = await createMockConnection();
    const lines: CapturedLine[] = [];
    const result = await run(
      graph,
      'gear.update',
      { id: 'gear-stove', notes: 'New valve' },
      {
        ctx: {
          extensions: { db: connection },
          logger: createCapturingLogger(lines),
          permit: operatorPermit,
        },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      lines.filter((line) => line.message.includes('recalculated'))
    ).toHaveLength(0);
  });
});
