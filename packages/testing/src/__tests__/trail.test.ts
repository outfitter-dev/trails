import { describe } from 'bun:test';

import { NotFoundError, Result, ValidationError, trail } from '@ontrails/core';
import { z } from 'zod';

import { testTrail } from '../trail.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

const greetTrail = trail('greet', {
  blaze: (input: { name: string }) =>
    Result.ok({ greeting: `Hello, ${input.name}` }),
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
});

const failTrail = trail('fail', {
  blaze: (input: { id: string }) => {
    if (input.id === 'missing') {
      return Result.err(new NotFoundError('Not found: missing'));
    }
    return Result.ok({ id: input.id });
  },
  input: z.object({ id: z.string() }),
});

// ---------------------------------------------------------------------------
// Tests
//
// Each call to testTrail registers describe/test blocks.
// We call them at the describe scope so bun:test can discover them.
// ---------------------------------------------------------------------------

describe('testTrail: expectOk', () => {
  // eslint-disable-next-line jest/require-hook
  testTrail(greetTrail, [
    { description: 'valid greeting', expectOk: true, input: { name: 'Bob' } },
  ]);
});

describe('testTrail: expectValue', () => {
  // eslint-disable-next-line jest/require-hook
  testTrail(greetTrail, [
    {
      description: 'exact match',
      expectValue: { greeting: 'Hello, Charlie' },
      input: { name: 'Charlie' },
    },
  ]);
});

describe('testTrail: expectErr', () => {
  // eslint-disable-next-line jest/require-hook
  testTrail(failTrail, [
    {
      description: 'not found error',
      expectErr: NotFoundError,
      input: { id: 'missing' },
    },
  ]);
});

describe('testTrail: expectErrMessage', () => {
  // eslint-disable-next-line jest/require-hook
  testTrail(failTrail, [
    {
      description: 'error message contains substring',
      expectErr: NotFoundError,
      expectErrMessage: 'Not found',
      input: { id: 'missing' },
    },
  ]);
});

describe('testTrail: invalid input with ValidationError', () => {
  // eslint-disable-next-line jest/require-hook
  testTrail(greetTrail, [
    {
      description: 'invalid input caught by validation',
      expectErr: ValidationError,
      input: { name: 123 },
    },
  ]);
});

describe('testTrail: multiple scenarios', () => {
  // eslint-disable-next-line jest/require-hook
  testTrail(greetTrail, [
    { description: 'scenario 1', expectOk: true, input: { name: 'A' } },
    { description: 'scenario 2', expectOk: true, input: { name: 'B' } },
    {
      description: 'scenario 3',
      expectValue: { greeting: 'Hello, C' },
      input: { name: 'C' },
    },
  ]);
});
