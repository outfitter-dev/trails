/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk/isErr */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { ActionResultContext } from '@ontrails/cli';
import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { tryQuietRunOutput } from '../run-quiet.js';
import { INNER_TRAIL_RESULT_KIND } from '../trails/run.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stubRunTrail = trail('run', {
  blaze: () => Result.ok(),
  description: 'stub run trail for quiet tests',
  input: z.object({ id: z.string() }),
  output: z.unknown(),
});

const stubOtherTrail = trail('other', {
  blaze: () => Result.ok(),
  description: 'stub non-run trail',
  input: z.object({}),
  output: z.unknown(),
});

const buildCtx = (
  trailObj: typeof stubRunTrail | typeof stubOtherTrail,
  flags: Record<string, unknown>,
  result: Result<unknown, Error>
): ActionResultContext => ({
  args: {},
  flags,
  input: {},
  result,
  topoName: 'trails',
  trail: trailObj as unknown as ActionResultContext['trail'],
});

const innerTrailResult = (value: unknown) => ({
  kind: INNER_TRAIL_RESULT_KIND,
  trailId: 'entity.show',
  value,
});

interface CapturedIO {
  readonly stdout: string[];
  readonly stderr: string[];
}

const withCapturedIO = async (
  fn: (io: CapturedIO) => Promise<void>
): Promise<CapturedIO> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: string) => {
    stdout.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    stderr.push(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn({ stderr, stdout });
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  return { stderr, stdout };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tryQuietRunOutput', () => {
  let originalTrailsJson: string | undefined;
  let originalTrailsJsonl: string | undefined;

  const restoreEnv = (key: 'TRAILS_JSON' | 'TRAILS_JSONL'): void => {
    const original =
      key === 'TRAILS_JSON' ? originalTrailsJson : originalTrailsJsonl;
    if (original === undefined) {
      // Static keys avoid the dynamic-delete lint rule.
      if (key === 'TRAILS_JSON') {
        delete process.env.TRAILS_JSON;
      } else {
        delete process.env.TRAILS_JSONL;
      }
      return;
    }
    process.env[key] = original;
  };

  beforeEach(() => {
    // Capture env vars that deriveOutputMode reads so per-topo flags from a
    // host environment cannot leak into assertions.
    originalTrailsJson = process.env['TRAILS_JSON'];
    originalTrailsJsonl = process.env['TRAILS_JSONL'];
    delete process.env.TRAILS_JSON;
    delete process.env.TRAILS_JSONL;
  });

  afterEach(() => {
    restoreEnv('TRAILS_JSON');
    restoreEnv('TRAILS_JSONL');
  });

  test('returns false when --quiet is not set on the run trail', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      {},
      Result.ok(innerTrailResult({ name: 'Alpha' }))
    );
    const io = await withCapturedIO(async () => {
      const handled = await tryQuietRunOutput(ctx);
      expect(handled).toBe(false);
    });
    expect(io.stdout.join('')).toBe('');
    expect(io.stderr.join('')).toBe('');
  });

  test('returns false on a non-run trail even with --quiet', async () => {
    const ctx = buildCtx(
      stubOtherTrail,
      { quiet: true },
      Result.ok({ name: 'Alpha' })
    );
    const handled = await tryQuietRunOutput(ctx);
    expect(handled).toBe(false);
  });

  test('returns false when the outer run-trail Result is Err (defer to default)', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { quiet: true },
      Result.err(new NotFoundError('no such trail'))
    );
    const handled = await tryQuietRunOutput(ctx);
    expect(handled).toBe(false);
  });

  test('inner result writes only the inner value to stdout (text mode, no provenance envelope)', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { quiet: true },
      Result.ok(innerTrailResult({ name: 'Alpha' }))
    );
    const io = await withCapturedIO(async () => {
      const handled = await tryQuietRunOutput(ctx);
      expect(handled).toBe(true);
    });
    const out = io.stdout.join('');
    // Text mode prints non-strings as JSON.stringify(value, null, 2).
    expect(out).toBe(`${JSON.stringify({ name: 'Alpha' }, null, 2)}\n`);
    expect(out).not.toContain('"kind"');
    expect(out).not.toContain('"trailId"');
    expect(out).not.toContain('"value"');
    expect(io.stderr.join('')).toBe('');
  });

  test('inner result composes with --json (single JSON document on stdout)', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { json: true, quiet: true },
      Result.ok(innerTrailResult({ name: 'Alpha' }))
    );
    const io = await withCapturedIO(async () => {
      const handled = await tryQuietRunOutput(ctx);
      expect(handled).toBe(true);
    });
    expect(io.stdout.join('')).toBe(
      `${JSON.stringify({ name: 'Alpha' }, null, 2)}\n`
    );
  });

  test('inner void result composes with --json as valid JSON null', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { json: true, quiet: true },
      Result.ok(innerTrailResult())
    );
    const io = await withCapturedIO(async () => {
      const handled = await tryQuietRunOutput(ctx);
      expect(handled).toBe(true);
    });
    expect(io.stdout.join('')).toBe('null\n');
    expect(JSON.parse(io.stdout.join(''))).toBeNull();
  });

  test('inner void result composes in text mode as JSON null', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { quiet: true },
      Result.ok(innerTrailResult())
    );
    const io = await withCapturedIO(async () => {
      const handled = await tryQuietRunOutput(ctx);
      expect(handled).toBe(true);
    });
    expect(io.stdout.join('')).toBe('null\n');
    expect(JSON.parse(io.stdout.join(''))).toBeNull();
  });

  test('inner result composes with --jsonl (one line per array item)', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { jsonl: true, quiet: true },
      Result.ok(innerTrailResult([{ id: 'a' }, { id: 'b' }]))
    );
    const io = await withCapturedIO(async () => {
      const handled = await tryQuietRunOutput(ctx);
      expect(handled).toBe(true);
    });
    expect(io.stdout.join('')).toBe(
      `${JSON.stringify({ id: 'a' })}\n${JSON.stringify({ id: 'b' })}\n`
    );
  });

  test('inner void result composes with --jsonl as valid JSON null', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { jsonl: true, quiet: true },
      Result.ok(innerTrailResult())
    );
    const io = await withCapturedIO(async () => {
      const handled = await tryQuietRunOutput(ctx);
      expect(handled).toBe(true);
    });
    expect(io.stdout.join('')).toBe('null\n');
    expect(JSON.parse(io.stdout.join(''))).toBeNull();
  });

  test('returns false when the run result is not an inner-result envelope', async () => {
    const ctx = buildCtx(
      stubRunTrail,
      { quiet: true },
      Result.ok({ raw: true })
    );
    const io = await withCapturedIO(async () => {
      const handled = await tryQuietRunOutput(ctx);
      expect(handled).toBe(false);
    });
    expect(io.stdout.join('')).toBe('');
    expect(io.stderr.join('')).toBe('');
  });
});

describe('--quiet | --input - pipe smoke test', () => {
  test('output of `run --quiet` is shaped to feed `run --input -` of another trail', async () => {
    // Stage 1: produce inner-value JSON on captured stdout under --quiet.
    const upstreamCtx = buildCtx(
      stubRunTrail,
      { json: true, quiet: true },
      Result.ok(innerTrailResult({ name: 'Alpha' }))
    );

    const captured = await withCapturedIO(async () => {
      const handled = await tryQuietRunOutput(upstreamCtx);
      expect(handled).toBe(true);
    });

    const piped = captured.stdout.join('');
    // Stage 2: confirm the captured stdout parses as the inner value (no
    // inner-result envelope), so a downstream `--input -` consumer
    // gets the trail's payload directly.
    const parsed: unknown = JSON.parse(piped);
    expect(parsed).toEqual({ name: 'Alpha' });
    if (typeof parsed === 'object' && parsed !== null) {
      expect('ok' in parsed).toBe(false);
      expect('kind' in parsed).toBe(false);
      expect('trailId' in parsed).toBe(false);
      expect('value' in parsed).toBe(false);
    }
  });
});
