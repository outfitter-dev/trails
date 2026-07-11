/**
 * Tests for CLI surface derivation absorbing pagination behavior.
 *
 * Verifies that when a trail's output has the paginated shape
 * (`items`, `hasMore`, optional `nextCursor`), the CLI command:
 *   - exposes an auto-derived `--all` flag,
 *   - aggregates pages when `--all` is set,
 *   - streams per-item JSONL when `--all --jsonl` are set together,
 *   - leaves non-paginated trails alone.
 */

import { describe, expect, test } from 'bun:test';

import type { ActionResultContext } from '../build.js';
import type { CliCommand } from '../command.js';
import { deriveCliCommands } from '../build.js';
import { Result, ValidationError, topo, trail } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildCommands = (...args: Parameters<typeof deriveCliCommands>) => {
  const result = deriveCliCommands(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const requireCommand = (commands: CliCommand[]): CliCommand => {
  const [command] = commands;
  if (!command) {
    throw new Error('Expected at least one command');
  }
  return command;
};

interface PageInput {
  readonly cursor?: string | undefined;
}

interface StringPage {
  readonly items: string[];
  readonly hasMore: boolean;
  readonly nextCursor?: string | undefined;
}

const PaginatedInput = z.object({
  cursor: z.string().optional(),
});

const PaginatedOutput = z.object({
  hasMore: z.boolean(),
  items: z.array(z.string()),
  nextCursor: z.string().optional(),
});

const makePaginatedTrail = (
  pages: readonly StringPage[]
): {
  readonly t: ReturnType<typeof trail<PageInput, StringPage>>;
  readonly callCount: () => number;
  readonly cursorsSeen: () => readonly (string | undefined)[];
} => {
  let calls = 0;
  const cursors: (string | undefined)[] = [];
  const t = trail('items.list', {
    implementation: (input: PageInput): Result<StringPage, Error> => {
      cursors.push(input.cursor);
      const idx = calls;
      calls += 1;
      const page = pages[idx];
      if (!page) {
        return Result.err(new Error(`No page at index ${idx}`));
      }
      return Result.ok(page);
    },
    input: PaginatedInput,
    output: PaginatedOutput,
  });
  return {
    callCount: () => calls,
    cursorsSeen: () => cursors,
    t,
  };
};

// ---------------------------------------------------------------------------
// Flag derivation
// ---------------------------------------------------------------------------

describe('CLI surface absorbs pagination — flag derivation', () => {
  test('paginated trail exposes auto-derived --all flag', () => {
    const { t } = makePaginatedTrail([{ hasMore: false, items: [] }]);
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const allFlag = command.flags.find((f) => f.name === 'all');
    expect(allFlag).toBeDefined();
    expect(allFlag?.type).toBe('boolean');
    expect(allFlag?.required).toBe(false);
  });

  test('non-paginated trail does NOT get --all flag', () => {
    const t = trail('greet', {
      implementation: (input: { name: string }) =>
        Result.ok(`Hello, ${input.name}`),
      input: z.object({ name: z.string() }),
    });
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const allFlag = command.flags.find((f) => f.name === 'all');
    expect(allFlag).toBeUndefined();
  });

  test('trail whose output has items but no hasMore does NOT get --all', () => {
    const t = trail('partial', {
      implementation: () => Result.ok({ items: [] }),
      input: z.object({}),
      output: z.object({ items: z.array(z.string()) }),
    });
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    expect(command.flags.find((f) => f.name === 'all')).toBeUndefined();
  });

  test('trail whose output has items + hasMore but no nextCursor does NOT get --all', () => {
    const t = trail('partial-no-cursor', {
      implementation: () => Result.ok({ hasMore: false, items: [] }),
      input: z.object({}),
      output: z.object({
        hasMore: z.boolean(),
        items: z.array(z.string()),
      }),
    });
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    expect(command.flags.find((f) => f.name === 'all')).toBeUndefined();
  });

  test('trail with paginated output but no input cursor does NOT get --all', () => {
    const t = trail('custom-cursor', {
      implementation: () =>
        Result.ok({
          hasMore: false,
          items: [],
          nextCursor: undefined,
        }),
      input: z.object({ pageToken: z.string().optional() }),
      output: PaginatedOutput,
    });
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    expect(command.flags.find((f) => f.name === 'all')).toBeUndefined();
  });

  test('non-paginated trail can own an all field without the meta flag stripping it', async () => {
    let receivedInput: { readonly all: boolean } | undefined;
    const t = trail('all-field', {
      implementation: (input: { all: boolean }) => {
        receivedInput = input;
        return Result.ok({ all: input.all });
      },
      input: z.object({ all: z.boolean() }),
      output: z.object({ all: z.boolean() }),
    });
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const result = await command.execute({}, { all: true });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    expect(command.flags.find((f) => f.name === 'all')).toBeDefined();
    expect(receivedInput).toEqual({ all: true });
    expect(result.value).toEqual({ all: true });
  });
});

// ---------------------------------------------------------------------------
// Iteration behavior — aggregate
// ---------------------------------------------------------------------------

describe('CLI surface absorbs pagination — --all aggregates pages', () => {
  test('aggregates items across 3 pages when --all is set', async () => {
    const { t, callCount, cursorsSeen } = makePaginatedTrail([
      { hasMore: true, items: ['a', 'b'], nextCursor: 'p2' },
      { hasMore: true, items: ['c', 'd'], nextCursor: 'p3' },
      { hasMore: false, items: ['e'] },
    ]);
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const result = await command.execute({}, { all: true });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    const value = result.value as {
      readonly items: readonly string[];
      readonly hasMore: boolean;
    };
    expect(value.items).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(value.hasMore).toBe(false);
    expect(callCount()).toBe(3);
    expect(cursorsSeen()).toEqual([undefined, 'p2', 'p3']);
  });

  test('aggregates unusually large pages without spreading items as call arguments', async () => {
    const items = Array.from({ length: 70_000 }, (_, idx) => `item-${idx}`);
    const { t } = makePaginatedTrail([{ hasMore: false, items }]);
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const result = await command.execute({}, { all: true });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    const value = result.value as {
      readonly items: readonly string[];
    };
    expect(value.items).toHaveLength(items.length);
    expect(value.items.at(0)).toBe('item-0');
    expect(value.items.at(-1)).toBe('item-69999');
  });

  test('--all with single first page (nextCursor undefined) returns just that page', async () => {
    const { t, callCount } = makePaginatedTrail([
      { hasMore: false, items: ['only'] },
    ]);
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const result = await command.execute({}, { all: true });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    const value = result.value as { readonly items: readonly string[] };
    expect(value.items).toEqual(['only']);
    expect(callCount()).toBe(1);
  });

  test('without --all, runs implementation once and returns the first page verbatim', async () => {
    const { t, callCount } = makePaginatedTrail([
      { hasMore: true, items: ['a'], nextCursor: 'p2' },
    ]);
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const result = await command.execute({}, {});

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    const value = result.value as {
      readonly items: readonly string[];
      readonly hasMore: boolean;
      readonly nextCursor?: string;
    };
    expect(value.items).toEqual(['a']);
    expect(value.hasMore).toBe(true);
    expect(value.nextCursor).toBe('p2');
    expect(callCount()).toBe(1);
  });

  test('hasMore with empty nextCursor fails instead of truncating', async () => {
    const { t, callCount } = makePaginatedTrail([
      { hasMore: true, items: ['only'], nextCursor: '' },
    ]);
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const result = await command.execute({}, { all: true });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('hasMore=true');
    expect(callCount()).toBe(1);
  });

  test('hasMore without nextCursor fails instead of truncating', async () => {
    const { t, callCount } = makePaginatedTrail([
      { hasMore: true, items: ['partial'] },
    ]);
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const result = await command.execute({}, { all: true });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('non-empty nextCursor');
    expect(callCount()).toBe(1);
  });

  test('repeated non-empty nextCursor fails instead of looping forever', async () => {
    const { t, callCount, cursorsSeen } = makePaginatedTrail([
      { hasMore: true, items: ['a'], nextCursor: 'p2' },
      { hasMore: true, items: ['b'], nextCursor: 'p2' },
    ]);
    const app = topo('test-app', { [t.id]: t });
    const command = requireCommand(buildCommands(app));

    const result = await command.execute({}, { all: true });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('repeated nextCursor "p2"');
    expect(callCount()).toBe(2);
    expect(cursorsSeen()).toEqual([undefined, 'p2']);
  });
});

// ---------------------------------------------------------------------------
// Streaming — --all --jsonl
// ---------------------------------------------------------------------------

describe('CLI surface absorbs pagination — --all --jsonl streaming', () => {
  test('streams one item per line across pages and signals streamed=true', async () => {
    const { t } = makePaginatedTrail([
      { hasMore: true, items: ['a', 'b'], nextCursor: 'p2' },
      { hasMore: true, items: ['c'], nextCursor: 'p3' },
      { hasMore: false, items: ['d', 'e'] },
    ]);
    const app = topo('test-app', { [t.id]: t });

    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    // Override write so we can capture without touching the real stdout.
    process.stdout.write = ((chunk: unknown): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    }) as typeof process.stdout.write;

    let captured: ActionResultContext | undefined;
    try {
      const command = requireCommand(
        buildCommands(app, {
          onResult: (ctx) => {
            captured = ctx;
            return Promise.resolve();
          },
        })
      );

      const result = await command.execute({}, { all: true, jsonl: true });
      expect(result.isOk()).toBe(true);
    } finally {
      process.stdout.write = originalWrite;
    }

    // Five items total, each emitted on its own line.
    expect(writes).toEqual([
      `${JSON.stringify('a')}\n`,
      `${JSON.stringify('b')}\n`,
      `${JSON.stringify('c')}\n`,
      `${JSON.stringify('d')}\n`,
      `${JSON.stringify('e')}\n`,
    ]);

    // The onResult ctx should advertise streaming so handlers can skip
    // re-writing the aggregated value.
    expect(captured).toBeDefined();
    expect(captured?.streamed).toBe(true);
  });

  test('streams a terminal non-page value when runtime pagination drifts', async () => {
    let calls = 0;
    const t = trail('items.list', {
      implementation: (): Result<unknown, Error> => {
        calls += 1;
        return Result.ok(
          calls === 1
            ? { hasMore: true, items: ['a'], nextCursor: 'p2' }
            : { message: 'done early' }
        );
      },
      input: PaginatedInput,
      output: z
        .object({
          hasMore: z.boolean().optional(),
          items: z.array(z.string()).optional(),
          nextCursor: z.string().optional(),
        })
        .passthrough(),
    });
    const app = topo('test-app', { [t.id]: t });

    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    }) as typeof process.stdout.write;

    let captured: ActionResultContext | undefined;
    try {
      const command = requireCommand(
        buildCommands(app, {
          onResult: (ctx) => {
            captured = ctx;
            return Promise.resolve();
          },
        })
      );

      const result = await command.execute({}, { all: true, jsonl: true });
      expect(result.isOk()).toBe(true);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(writes).toEqual([
      `${JSON.stringify('a')}\n`,
      `${JSON.stringify({ message: 'done early' })}\n`,
    ]);
    expect(captured?.streamed).toBe(true);
  });

  test('--jsonl without --all does NOT stream from the iteration helper', async () => {
    const { t, callCount } = makePaginatedTrail([
      { hasMore: true, items: ['a'], nextCursor: 'p2' },
    ]);
    const app = topo('test-app', { [t.id]: t });

    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    }) as typeof process.stdout.write;

    let captured: ActionResultContext | undefined;
    try {
      const command = requireCommand(
        buildCommands(app, {
          onResult: (ctx) => {
            captured = ctx;
            return Promise.resolve();
          },
        })
      );

      await command.execute({}, { jsonl: true });
    } finally {
      process.stdout.write = originalWrite;
    }

    // No streaming occurred — the iteration helper was never engaged.
    expect(writes).toEqual([]);
    expect(callCount()).toBe(1);
    expect(captured?.streamed).toBeFalsy();
  });
});
