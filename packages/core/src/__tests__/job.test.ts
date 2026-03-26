import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { jobOutputSchema } from '../job';

describe('jobOutputSchema', () => {
  test('parses a valid completed job output', () => {
    const input = {
      completedAt: '2026-03-25T00:01:00Z',
      current: 10,
      jobId: 'job-123',
      percentage: 100,
      result: { rows: 42 },
      startedAt: '2026-03-25T00:00:00Z',
      status: 'completed',
      total: 10,
    };

    const parsed = jobOutputSchema.parse(input);

    expect(parsed.jobId).toBe('job-123');
    expect(parsed.status).toBe('completed');
    expect(parsed.current).toBe(10);
    expect(parsed.total).toBe(10);
  });

  test('parses a minimal pending job output', () => {
    const input = {
      current: 0,
      jobId: 'job-456',
      status: 'pending',
      total: 100,
    };

    const parsed = jobOutputSchema.parse(input);

    expect(parsed.jobId).toBe('job-456');
    expect(parsed.status).toBe('pending');
    expect(parsed.result).toBeUndefined();
    expect(parsed.error).toBeUndefined();
  });

  test('parses a failed job with error', () => {
    const input = {
      current: 3,
      error: 'connection reset',
      jobId: 'job-789',
      status: 'failed',
      total: 10,
    };

    const parsed = jobOutputSchema.parse(input);

    expect(parsed.status).toBe('failed');
    expect(parsed.error).toBe('connection reset');
  });

  test('rejects when jobId is missing', () => {
    const input = {
      current: 1,
      status: 'running',
      total: 5,
    };

    expect(() => jobOutputSchema.parse(input)).toThrow();
  });

  test('rejects an invalid status value', () => {
    const input = {
      current: 0,
      jobId: 'job-bad',
      status: 'unknown',
      total: 0,
    };

    expect(() => jobOutputSchema.parse(input)).toThrow();
  });

  test('composes statusFields and progressFields correctly', () => {
    const { shape } = jobOutputSchema;

    // Status field from statusFields()
    expect(shape.status).toBeInstanceOf(z.ZodEnum);

    // Progress fields from progressFields()
    expect(shape.current).toBeInstanceOf(z.ZodNumber);
    expect(shape.total).toBeInstanceOf(z.ZodNumber);
    expect(shape.percentage).toBeDefined();

    // Job-specific fields
    expect(shape.jobId).toBeInstanceOf(z.ZodString);
    expect(shape.error).toBeDefined();
    expect(shape.result).toBeDefined();
    expect(shape.startedAt).toBeDefined();
    expect(shape.completedAt).toBeDefined();
  });
});
