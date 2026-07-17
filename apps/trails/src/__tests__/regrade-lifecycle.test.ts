import { Result, ValidationError } from '@ontrails/core';
import { describe, expect, test } from 'bun:test';

import { RegradeLifecycleTracker } from '../regrade/lifecycle.js';
import { usesStructuredCliOutput } from '../run-regrade-progress.js';

describe('Regrade lifecycle tracking', () => {
  test('records completed phases with deterministic elapsed timings', async () => {
    const times = [0, 5, 12, 20];
    const events: { readonly message?: string; readonly type: string }[] = [];
    const lifecycle = new RegradeLifecycleTracker({
      now: () => times.shift() ?? 20,
      progress: (event) => events.push(event),
    });

    const result = await lifecycle.run('derive-plan', () =>
      Result.ok('complete')
    );

    expect(result.isOk()).toBe(true);
    expect(lifecycle.summary()).toEqual({
      durationMs: 20,
      phases: [{ durationMs: 7, name: 'derive-plan', status: 'completed' }],
    });
    expect(events).toMatchObject([
      { message: 'Regrade: derive plan', type: 'start' },
      { message: 'Regrade: derive plan complete (7 ms)', type: 'complete' },
    ]);
  });

  test('reports failed phases without recording them as completed', async () => {
    const events: { readonly message?: string; readonly type: string }[] = [];
    const lifecycle = new RegradeLifecycleTracker({
      now: () => 10,
      progress: (event) => events.push(event),
    });

    const result = await lifecycle.run('check-plan', () =>
      Result.err(new ValidationError('stale plan'))
    );

    expect(result.isErr()).toBe(true);
    expect(lifecycle.summary().phases).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      message: 'Regrade: check plan failed (0 ms)',
      type: 'error',
    });
  });
});

describe('Regrade CLI progress channels', () => {
  test('recognizes every supported structured output selector', () => {
    expect(usesStructuredCliOutput(['--json'], {})).toBe(true);
    expect(usesStructuredCliOutput(['--jsonl'], {})).toBe(true);
    expect(usesStructuredCliOutput(['--output', 'json'], {})).toBe(true);
    expect(usesStructuredCliOutput(['-o=jsonl'], {})).toBe(true);
    expect(usesStructuredCliOutput(['-ojson'], {})).toBe(true);
    expect(usesStructuredCliOutput(['-qojsonl'], {})).toBe(true);
    expect(usesStructuredCliOutput(['-qotext'], {})).toBe(false);
    expect(usesStructuredCliOutput(['-qqo', 'jsonl'], {})).toBe(true);
    expect(usesStructuredCliOutput(['--output', 'text', '-qojsonl'], {})).toBe(
      true
    );
    expect(
      usesStructuredCliOutput(['--output', 'text', '--output=jsonl'], {})
    ).toBe(true);
    expect(usesStructuredCliOutput(['-ojsonl', '-o', 'text'], {})).toBe(false);
    expect(usesStructuredCliOutput(['-qojsonl', '-qo', 'text'], {})).toBe(
      false
    );
    expect(usesStructuredCliOutput([], { TRAILS_JSON: '1' })).toBe(true);
    expect(usesStructuredCliOutput([], { TRAILS_JSONL: '1' })).toBe(true);
    expect(usesStructuredCliOutput(['--output', 'text'], {})).toBe(false);
    expect(
      usesStructuredCliOutput(['--output', 'text'], { TRAILS_JSON: '1' })
    ).toBe(false);
    expect(
      usesStructuredCliOutput(['--', '--output', 'text'], {
        TRAILS_JSONL: '1',
      })
    ).toBe(true);
    expect(usesStructuredCliOutput(['--', '--json'], {})).toBe(false);
    expect(
      usesStructuredCliOutput(
        ['--output', 'jsonl', '--', '--output', 'text'],
        {}
      )
    ).toBe(true);
    expect(usesStructuredCliOutput(['--output'], { TRAILS_JSONL: '1' })).toBe(
      true
    );
    expect(usesStructuredCliOutput(['-o'], { TRAILS_JSONL: '1' })).toBe(true);
    expect(
      usesStructuredCliOutput(['--output', '--dry-run'], {
        TRAILS_JSONL: '1',
      })
    ).toBe(true);
    expect(usesStructuredCliOutput(['--output', 'jsonl', '--output'], {})).toBe(
      false
    );
    expect(
      usesStructuredCliOutput(['--output', 'text', '--output'], {
        TRAILS_JSONL: '1',
      })
    ).toBe(true);
  });
});
