/**
 * End-to-end coverage for `trails run` structured input.
 *
 * Structured input maps to the inner trail payload. Direct JSON objects are
 * treated as the resolved trail's input, while the explicit `input` wrapper
 * remains available for callers that need to pass fields that collide with
 * `run` control fields.
 *
 * The inner `run()` invocation then fails (the workspace fixture has no
 * matching trail), but that is by design — what matters here is that
 * structured-input payloads reach the `run` trail before execution.
 */
/* oxlint-disable-next-line eslint-plugin-jest/no-conditional-expect -- Result-shape assertions branch on isOk/isErr */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveCliCommands } from '@ontrails/cli';
import type { ActionResultContext, CliCommand } from '@ontrails/cli';

import { app } from '../app.js';

const findRunCommand = (
  commands: readonly CliCommand[]
): CliCommand | undefined => commands.find((c) => c.path[0] === 'run');

interface CapturedInvocation {
  input?: unknown;
  trailId?: string | undefined;
}

const buildRunCommand = (capture?: CapturedInvocation): CliCommand => {
  const onResult =
    capture === undefined
      ? undefined
      : (ctx: ActionResultContext): Promise<void> => {
          capture.input = ctx.input;
          capture.trailId = ctx.trail.id;
          return Promise.resolve();
        };

  const result = deriveCliCommands(app, {
    onResult,
  });
  if (result.isErr()) {
    throw result.error;
  }
  const cmd = findRunCommand(result.value);
  if (!cmd) {
    throw new Error('Expected run command in derived CLI commands');
  }
  return cmd;
};

const isInputRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `run-input-sources-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { force: true, recursive: true });
});

describe('trails run structured-input mapping', () => {
  test('exposes id and inline JSON as run command positional arguments', () => {
    const cmd = buildRunCommand();
    expect(cmd.args.map((a) => a.name)).toEqual(['id', 'inline-json']);
  });

  test('merges --input-json into the run trail input', async () => {
    const captured: CapturedInvocation = {};
    const cmd = buildRunCommand(captured);

    await cmd.execute(
      { id: 'never.exists' },
      {
        inputJson: '{"name":"Alpha"}',
        rootDir: workspaceRoot,
      }
    );

    expect(captured.trailId).toBe('run');
    expect(isInputRecord(captured.input)).toBe(true);
    if (isInputRecord(captured.input)) {
      expect(captured.input['id']).toBe('never.exists');
      expect(captured.input['name']).toBe('Alpha');
      expect(captured.input['input']).toBeUndefined();
    }
  });

  test('preserves the explicit input wrapper for control-field collisions', async () => {
    const captured: CapturedInvocation = {};
    const cmd = buildRunCommand(captured);

    await cmd.execute(
      { id: 'never.exists' },
      {
        inputJson: '{"input":{"module":"inner-value"}}',
        rootDir: workspaceRoot,
      }
    );

    expect(captured.trailId).toBe('run');
    expect(isInputRecord(captured.input)).toBe(true);
    if (isInputRecord(captured.input)) {
      expect(captured.input['id']).toBe('never.exists');
      expect(captured.input['input']).toEqual({ module: 'inner-value' });
    }
  });

  test('merges positional inline JSON into the run trail input', async () => {
    const captured: CapturedInvocation = {};
    const cmd = buildRunCommand(captured);

    await cmd.execute(
      {
        id: 'never.exists',
        'inline-json': '{"name":"Echo"}',
      },
      {
        rootDir: workspaceRoot,
      }
    );

    expect(captured.trailId).toBe('run');
    expect(isInputRecord(captured.input)).toBe(true);
    if (isInputRecord(captured.input)) {
      expect(captured.input['id']).toBe('never.exists');
      expect(captured.input['name']).toBe('Echo');
      expect(captured.input['input']).toBeUndefined();
    }
  });

  test('rejects when positional inline JSON conflicts with --input-json', async () => {
    const cmd = buildRunCommand();

    const result = await cmd.execute(
      {
        id: 'never.exists',
        'inline-json': '{"input":{"name":"Echo"}}',
      },
      {
        inputJson: '{"input":{"name":"Foxtrot"}}',
        rootDir: workspaceRoot,
      }
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(
        'Use only one structured input source at a time'
      );
    }
  });

  test('merges --input file payloads into the run trail input', async () => {
    const captured: CapturedInvocation = {};
    const cmd = buildRunCommand(captured);

    const inputPath = join(workspaceRoot, 'payload.json');
    writeFileSync(inputPath, '{"name":"Bravo"}');

    await cmd.execute(
      { id: 'never.exists' },
      {
        input: inputPath,
        rootDir: workspaceRoot,
      }
    );

    expect(isInputRecord(captured.input)).toBe(true);
    if (isInputRecord(captured.input)) {
      expect(captured.input['name']).toBe('Bravo');
      expect(captured.input['input']).toBeUndefined();
    }
  });

  test('rejects when --input and --input-json are both provided', async () => {
    const cmd = buildRunCommand();

    const result = await cmd.execute(
      { id: 'never.exists' },
      {
        input: join(workspaceRoot, 'payload.json'),
        inputJson: '{"name":"Y"}',
        rootDir: workspaceRoot,
      }
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(
        'Use only one structured input source at a time'
      );
    }
  });

  test('merges --input - payloads into the run trail input', async () => {
    const captured: CapturedInvocation = {};
    const cmd = buildRunCommand(captured);

    interface StdinSubset {
      isTTY: boolean | undefined;
      [Symbol.asyncIterator]: () => AsyncIterableIterator<Buffer>;
    }
    const originalStdin = process.stdin;
    const fakeStdin: StdinSubset = {
      isTTY: false,
      [Symbol.asyncIterator]: () => {
        let yielded = false;
        const iterator: AsyncIterableIterator<Buffer> = {
          next: () => {
            if (yielded) {
              return Promise.resolve({ done: true, value: undefined });
            }
            yielded = true;
            return Promise.resolve({
              done: false,
              value: Buffer.from('{"name":"Delta"}', 'utf8'),
            });
          },
          [Symbol.asyncIterator]() {
            return iterator;
          },
        };
        return iterator;
      },
    };
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: fakeStdin,
    });

    try {
      await cmd.execute(
        { id: 'never.exists' },
        {
          input: '-',
          rootDir: workspaceRoot,
        }
      );
    } finally {
      Object.defineProperty(process, 'stdin', {
        configurable: true,
        value: originalStdin,
      });
    }

    expect(isInputRecord(captured.input)).toBe(true);
    if (isInputRecord(captured.input)) {
      expect(captured.input['name']).toBe('Delta');
      expect(captured.input['input']).toBeUndefined();
    }
  });
});
