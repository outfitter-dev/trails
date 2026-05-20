import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { executeTrailRevision } from '../version-runtime';
import { Result } from '../result';
import { trail } from '../trail';

describe('executeTrailRevision', () => {
  test('transposes historical input into current and current output back to historical', async () => {
    let currentInput:
      | { fullName: string; notify: boolean; source: string }
      | undefined;
    let inputArgCount = 0;
    let outputArgCount = 0;
    const createInvite = trail('invite.create', {
      blaze: (input) => {
        currentInput = input;
        return Result.ok({
          auditLevel: 'current' as const,
          message: `Invited ${input.fullName}`,
          state: 'sent' as const,
        });
      },
      input: z.object({
        fullName: z.string(),
        notify: z.boolean(),
        source: z.string(),
      }),
      output: z.object({
        auditLevel: z.enum(['current', 'legacy']),
        message: z.string(),
        state: z.enum(['queued', 'sent']),
      }),
      version: 2,
      versions: {
        1: {
          input: z.object({ name: z.string() }),
          output: z.object({
            message: z.string(),
            state: z.literal('sent'),
          }),
          transpose: {
            input(value) {
              inputArgCount = arguments.length;
              const historical = value.input as { name: string };
              return {
                fullName: historical.name,
                notify: true,
                source: 'v1',
              };
            },
            output(value) {
              outputArgCount = arguments.length;
              const current = value.output as {
                auditLevel: string;
                message: string;
                state: 'queued' | 'sent';
              };
              return { message: current.message, state: current.state };
            },
          },
        },
      },
    });

    const result = await executeTrailRevision(
      createInvite,
      1,
      createInvite.versions?.[1] ?? expect.unreachable(),
      { name: 'Ada' }
    );

    expect(result.unwrap()).toEqual({
      message: 'Invited Ada',
      state: 'sent',
    });
    expect(currentInput).toEqual({
      fullName: 'Ada',
      notify: true,
      source: 'v1',
    });
    expect(inputArgCount).toBe(1);
    expect(outputArgCount).toBe(1);
  });

  test('allows metadata-only revisions with matching schemas', async () => {
    const echo = trail('echo.versioned', {
      blaze: (input) => Result.ok({ value: input.value }),
      input: z.object({ value: z.string() }),
      output: z.object({ value: z.string() }),
      version: 2,
      versions: {
        1: {
          input: z.object({ value: z.string() }),
          output: z.object({ value: z.string() }),
        },
      },
    });

    const result = await executeTrailRevision(
      echo,
      1,
      echo.versions?.[1] ?? expect.unreachable(),
      { value: 'stable' }
    );

    expect(result.unwrap()).toEqual({ value: 'stable' });
  });

  test('returns validation errors when transpose output violates historical output', async () => {
    const stateTrail = trail('state.versioned', {
      blaze: () => Result.ok({ state: 'queued' as const }),
      input: z.object({}),
      output: z.object({ state: z.enum(['queued', 'sent']) }),
      version: 2,
      versions: {
        1: {
          input: z.object({}),
          output: z.object({ state: z.literal('sent') }),
          transpose: {
            input: ({ input }) => input,
            output: ({ output }) => output,
          },
        },
      },
    });

    const result = await executeTrailRevision(
      stateTrail,
      1,
      stateTrail.versions?.[1] ?? expect.unreachable(),
      {}
    );

    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toContain('Output validation failed');
  });

  test('returns validation errors when transpose input violates current input', async () => {
    const requiresCurrent = trail('requires.current', {
      blaze: (input) => Result.ok({ id: input.id }),
      input: z.object({ id: z.string(), requiredNow: z.string() }),
      output: z.object({ id: z.string() }),
      version: 2,
      versions: {
        1: {
          input: z.object({ id: z.string() }),
          output: z.object({ id: z.string() }),
          transpose: {
            input: ({ input }) => input,
            output: ({ output }) => output,
          },
        },
      },
    });

    const result = await executeTrailRevision(
      requiresCurrent,
      1,
      requiresCurrent.versions?.[1] ?? expect.unreachable(),
      { id: 'old' }
    );

    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toContain('requiredNow');
  });
});
