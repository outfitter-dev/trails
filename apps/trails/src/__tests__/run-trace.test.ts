/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- result-shape assertions branch on isOk/isErr */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { ActionResultContext } from '@ontrails/cli';
import {
  NOOP_SINK,
  Result,
  ValidationError,
  clearTraceSink,
  executeTrail,
  getTraceSink,
  registerTraceSink,
  trail,
} from '@ontrails/core';
import type { TraceRecord } from '@ontrails/core';
import { z } from 'zod';

import {
  argvHasTraceFlag,
  buildTraceJsonEnvelope,
  installTraceSink,
  tryTraceJsonOutput,
  writeTraceTreeToStderr,
} from '../run-trace.js';

// ---------------------------------------------------------------------------
// Captured-IO helper
// ---------------------------------------------------------------------------

interface CapturedIO {
  readonly stdout: string[];
  readonly stderr: string[];
}

const withCapturedIO = async (
  fn: (io: CapturedIO) => Promise<void> | void
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
// Stub trails for unit-level helper tests
// ---------------------------------------------------------------------------

const stubRunTrail = trail('run', {
  description: 'stub run trail for trace tests',
  implementation: () => Result.ok(),
  input: z.object({ trailId: z.string() }),
  output: z.unknown(),
});

const greetTrail = trail('greet', {
  description: 'simple trail used to drive executeTrail and emit a record',
  implementation: ({ name }: { name: string }) =>
    Result.ok({ greeting: `hi ${name}` }),
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
});

const failingTrail = trail('fail', {
  description: 'trail that always fails for trace-error tests',
  implementation: () => Result.err(new ValidationError('intentional failure')),
  input: z.object({}),
  output: z.unknown(),
});

const buildCtx = (
  flags: Record<string, unknown>,
  result: Result<unknown, Error>,
  trailId = 'run'
): ActionResultContext => ({
  args: {},
  flags,
  input: {},
  result,
  topoName: 'trails',
  trail: {
    ...stubRunTrail,
    id: trailId,
  } as unknown as ActionResultContext['trail'],
});

// ---------------------------------------------------------------------------
// Argv detection
// ---------------------------------------------------------------------------

describe('argvHasTraceFlag', () => {
  test('returns true when --trace is present', () => {
    expect(argvHasTraceFlag(['node', 'trails', 'run', 'foo', '--trace'])).toBe(
      true
    );
  });

  test('returns false when --trace is absent', () => {
    expect(argvHasTraceFlag(['node', 'trails', 'run', 'foo'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JSON envelope
// ---------------------------------------------------------------------------

describe('buildTraceJsonEnvelope', () => {
  test('shapes a successful Result into { ok: true, value, tracing }', () => {
    const records: readonly TraceRecord[] = [];
    const envelope = buildTraceJsonEnvelope(
      Result.ok({ greeting: 'hi Alpha' }),
      records
    );
    expect(envelope).toEqual({
      ok: true,
      tracing: [],
      value: { greeting: 'hi Alpha' },
    });
  });

  test('shapes a failing Result into { ok: false, error, tracing }', () => {
    const error = new ValidationError('bad input');
    const records: readonly TraceRecord[] = [];
    const envelope = buildTraceJsonEnvelope(Result.err(error), records);
    expect(envelope).toEqual({
      error: { message: 'bad input', name: 'ValidationError' },
      ok: false,
      tracing: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Sink session
// ---------------------------------------------------------------------------

describe('installTraceSink', () => {
  beforeEach(() => {
    clearTraceSink();
  });

  afterEach(() => {
    clearTraceSink();
  });

  test('replaces the registry sink and finalize() restores the previous one', () => {
    expect(getTraceSink()).toBe(NOOP_SINK);
    const session = installTraceSink();
    expect(getTraceSink()).toBe(session.sink);
    const records = session.finalize();
    expect(records).toEqual([]);
    expect(getTraceSink()).toBe(NOOP_SINK);
  });

  test('captures records emitted during executeTrail', async () => {
    const session = installTraceSink();
    const result = await executeTrail(greetTrail, { name: 'Alpha' });
    const records = session.finalize();
    expect(result.isOk()).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    const trailRecord = records.find((r) => r.trailId === 'greet');
    expect(trailRecord).toBeDefined();
    expect(trailRecord?.status).toBe('ok');
  });

  test('captures records when the trail fails (status: err)', async () => {
    const session = installTraceSink();
    await executeTrail(failingTrail, {});
    const records = session.finalize();
    const trailRecord = records.find((r) => r.trailId === 'fail');
    expect(trailRecord).toBeDefined();
    expect(trailRecord?.status).toBe('err');
  });

  test('two consecutive sessions do not bleed records', async () => {
    const first = installTraceSink();
    await executeTrail(greetTrail, { name: 'first' });
    const firstRecords = first.finalize();

    const second = installTraceSink();
    await executeTrail(greetTrail, { name: 'second' });
    const secondRecords = second.finalize();

    const firstIds = new Set(firstRecords.map((r) => r.id));
    const secondIds = new Set(secondRecords.map((r) => r.id));
    for (const id of secondIds) {
      expect(firstIds.has(id)).toBe(false);
    }
    // Sanity: each session captured at least the trail's own root record.
    expect(firstRecords.some((r) => r.trailId === 'greet')).toBe(true);
    expect(secondRecords.some((r) => r.trailId === 'greet')).toBe(true);
  });

  test('finalize() is idempotent: subsequent calls return an empty snapshot', () => {
    const session = installTraceSink();
    session.finalize();
    expect(session.finalize()).toEqual([]);
  });

  test('installs nothing when --trace is absent (sink stays NOOP)', () => {
    expect(getTraceSink()).toBe(NOOP_SINK);
  });
});

// ---------------------------------------------------------------------------
// Stderr tree
// ---------------------------------------------------------------------------

describe('writeTraceTreeToStderr', () => {
  test('renders the tree to stderr with a trailing newline', async () => {
    const session = installTraceSink();
    await executeTrail(greetTrail, { name: 'Alpha' });
    const records = session.finalize();

    const io = await withCapturedIO(() => {
      writeTraceTreeToStderr(records);
    });

    expect(io.stdout.join('')).toBe('');
    const stderr = io.stderr.join('');
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr.endsWith('\n')).toBe(true);
    expect(stderr).toContain('greet');
  });

  test('no-ops on an empty record list', async () => {
    const io = await withCapturedIO(() => {
      writeTraceTreeToStderr([]);
    });
    expect(io.stdout.join('')).toBe('');
    expect(io.stderr.join('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// onResult bridge: tryTraceJsonOutput
// ---------------------------------------------------------------------------

describe('tryTraceJsonOutput', () => {
  beforeEach(() => {
    clearTraceSink();
  });

  afterEach(() => {
    clearTraceSink();
  });

  test('returns false when --trace is not set', async () => {
    const session = installTraceSink();
    const ctx = buildCtx({ json: true }, Result.ok({ name: 'Alpha' }));
    const io = await withCapturedIO(() => {
      const handled = tryTraceJsonOutput(ctx, session);
      expect(handled).toBe(false);
    });
    session.finalize();
    expect(io.stdout.join('')).toBe('');
  });

  test('returns false when --trace is set but --json is not', async () => {
    const session = installTraceSink();
    const ctx = buildCtx({ trace: true }, Result.ok({ name: 'Alpha' }));
    const io = await withCapturedIO(() => {
      const handled = tryTraceJsonOutput(ctx, session);
      expect(handled).toBe(false);
    });
    session.finalize();
    expect(io.stdout.join('')).toBe('');
  });

  test('returns false under --trace --quiet (deferred to quiet handler)', async () => {
    const session = installTraceSink();
    const ctx = buildCtx(
      { json: true, quiet: true, trace: true },
      Result.ok({ name: 'Alpha' })
    );
    const io = await withCapturedIO(() => {
      const handled = tryTraceJsonOutput(ctx, session);
      expect(handled).toBe(false);
    });
    session.finalize();
    expect(io.stdout.join('')).toBe('');
  });

  test('returns false for run.example under --trace --json', async () => {
    const session = installTraceSink();
    const ctx = buildCtx(
      { json: true, trace: true },
      Result.ok({ kind: 'run.example.comparison' }),
      'run.example'
    );
    const io = await withCapturedIO(() => {
      const handled = tryTraceJsonOutput(ctx, session);
      expect(handled).toBe(false);
    });
    session.finalize();
    expect(io.stdout.join('')).toBe('');
  });

  test('returns false for run.examples under --trace --json', async () => {
    const session = installTraceSink();
    const ctx = buildCtx(
      { json: true, trace: true },
      Result.ok({ examples: [], kind: 'run.examples.listing' }),
      'run.examples'
    );
    const io = await withCapturedIO(() => {
      const handled = tryTraceJsonOutput(ctx, session);
      expect(handled).toBe(false);
    });
    session.finalize();
    expect(io.stdout.join('')).toBe('');
  });

  test('returns false under --trace --jsonl (line-delimited stream)', async () => {
    const session = installTraceSink();
    const ctx = buildCtx({ jsonl: true, trace: true }, Result.ok([1, 2, 3]));
    const io = await withCapturedIO(() => {
      const handled = tryTraceJsonOutput(ctx, session);
      expect(handled).toBe(false);
    });
    session.finalize();
    expect(io.stdout.join('')).toBe('');
  });

  test('emits envelope on stdout under --trace --json', async () => {
    const session = installTraceSink();
    await executeTrail(greetTrail, { name: 'Alpha' });
    const ctx = buildCtx(
      { json: true, trace: true },
      Result.ok({ greeting: 'hi Alpha' })
    );
    const io = await withCapturedIO(() => {
      const handled = tryTraceJsonOutput(ctx, session);
      expect(handled).toBe(true);
    });
    const records = session.finalize();

    expect(io.stderr.join('')).toBe('');
    const stdout = io.stdout.join('');
    expect(stdout.endsWith('\n')).toBe(true);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      ok: true,
      value: { greeting: 'hi Alpha' },
    });
    expect(parsed).toHaveProperty('tracing');
    const parsedRecord = parsed as { readonly tracing: readonly unknown[] };
    expect(Array.isArray(parsedRecord.tracing)).toBe(true);
    expect(parsedRecord.tracing.length).toBe(records.length);
    // Each round-tripped record must carry the canonical TraceRecord
    // identity fields. Optional `undefined` fields are dropped by JSON, so
    // we assert the load-bearing identifiers rather than deep-equality.
    const trailRecord = records.find((r) => r.trailId === 'greet');
    expect(trailRecord).toBeDefined();
    expect(parsedRecord.tracing).toContainEqual(
      expect.objectContaining({
        id: trailRecord?.id,
        kind: 'trail',
        name: 'greet',
        status: 'ok',
        trailId: 'greet',
      })
    );
  });

  test('emits envelope on stdout under --output json (non-shorthand form)', async () => {
    const session = installTraceSink();
    const ctx = buildCtx(
      { output: 'json', trace: true },
      Result.ok({ greeting: 'hi Alpha' })
    );
    const io = await withCapturedIO(() => {
      const handled = tryTraceJsonOutput(ctx, session);
      expect(handled).toBe(true);
    });
    session.finalize();

    const parsed: unknown = JSON.parse(io.stdout.join(''));
    expect(parsed).toMatchObject({
      ok: true,
      value: { greeting: 'hi Alpha' },
    });
  });

  test('emits ok=false envelope when the result is Err', async () => {
    const session = installTraceSink();
    const ctx = buildCtx(
      { json: true, trace: true },
      Result.err(new ValidationError('bad input'))
    );
    const io = await withCapturedIO(() => {
      const handled = tryTraceJsonOutput(ctx, session);
      expect(handled).toBe(true);
    });
    session.finalize();

    const parsed: unknown = JSON.parse(io.stdout.join(''));
    expect(parsed).toEqual({
      error: { message: 'bad input', name: 'ValidationError' },
      ok: false,
      tracing: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Stream isolation (stderr never contaminates stdout)
// ---------------------------------------------------------------------------

describe('stream isolation under --trace', () => {
  beforeEach(() => {
    clearTraceSink();
  });

  afterEach(() => {
    clearTraceSink();
  });

  test('tree never appears on stdout when --trace --json is set', async () => {
    const session = installTraceSink();
    await executeTrail(greetTrail, { name: 'Alpha' });
    const ctx = buildCtx(
      { json: true, trace: true },
      Result.ok({ greeting: 'hi Alpha' })
    );

    const io = await withCapturedIO(() => {
      tryTraceJsonOutput(ctx, session);
    });
    const records = session.finalize();
    const treeIO = await withCapturedIO(() => {
      writeTraceTreeToStderr(records);
    });

    // The first capture only saw the JSON envelope (stdout) -- no tree.
    expect(io.stderr.join('')).toBe('');
    const stdout = io.stdout.join('');
    expect(stdout).not.toContain('●');
    expect(stdout).not.toContain('└─');

    // The tree only appears on stderr in the second capture.
    expect(treeIO.stdout.join('')).toBe('');
    expect(treeIO.stderr.join('')).toContain('greet');
  });
});

// ---------------------------------------------------------------------------
// Pre-existing sink restoration
// ---------------------------------------------------------------------------

describe('previous sink restoration', () => {
  beforeEach(() => {
    clearTraceSink();
  });

  afterEach(() => {
    clearTraceSink();
  });

  test('restores a host-installed sink, not the noop, after finalize', () => {
    const collected: TraceRecord[] = [];
    const hostSink = {
      write: (record: TraceRecord) => {
        collected.push(record);
      },
    };
    registerTraceSink(hostSink);
    expect(getTraceSink()).toBe(hostSink);

    const session = installTraceSink();
    expect(getTraceSink()).toBe(session.sink);
    session.finalize();
    expect(getTraceSink()).toBe(hostSink);
  });
});
