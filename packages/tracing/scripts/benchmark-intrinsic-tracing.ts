/* oxlint-disable eslint-plugin-import/consistent-type-specifier-style -- single import keeps the benchmark script lint-clean */
/* oxlint-disable eslint-plugin-jest/require-hook -- standalone benchmark script, not a test file */

import {
  NOOP_SINK,
  Result,
  executeTrail,
  registerTraceSink,
  trail,
  type AnyTrail,
  type TraceSink,
} from '../../core/src/index.ts';
import { z } from 'zod';

interface Scenario {
  readonly input: unknown;
  readonly iterations: number;
  readonly name: string;
  readonly samples: number;
  readonly trail: AnyTrail;
}

interface Sample {
  readonly baselineMs: number;
  readonly overheadPct: number;
  readonly tracedMs: number;
}

const wrappedNoopSink: TraceSink = {
  write: () => 0,
};

const emptyIO = z.object({});
const typicalInput = z.object({
  count: z.number().int().nonnegative(),
  id: z.string().uuid(),
  label: z.string().min(3),
  tags: z.array(z.string()).max(4),
});
const ioInput = z.object({
  jobId: z.string(),
});

const trivialTrail = trail('bench.tracing.trivial', {
  blaze: () => Result.ok({ ok: true }),
  input: emptyIO,
  output: z.object({ ok: z.boolean() }),
});

const typicalTrail = trail('bench.tracing.typical', {
  blaze: (input) =>
    Result.ok({
      checksum: `${input.id}:${input.label}:${input.tags.length}`,
      count: input.count + 1,
      ok: true,
    }),
  input: typicalInput,
  output: z.object({
    checksum: z.string(),
    count: z.number(),
    ok: z.boolean(),
  }),
});

const ioTrail = trail('bench.tracing.io', {
  blaze: async (input) => {
    await Bun.sleep(1);
    return Result.ok({ jobId: input.jobId, ok: true });
  },
  input: ioInput,
  output: z.object({
    jobId: z.string(),
    ok: z.boolean(),
  }),
});

const scenarios: readonly Scenario[] = [
  {
    input: {},
    iterations: 20_000,
    name: 'pure no-op trail',
    samples: 6,
    trail: trivialTrail,
  },
  {
    input: {
      count: 2,
      id: '0f2b6d6a-3b22-4e6b-a4e8-9f5f3c2d5f9a',
      label: 'alpha',
      tags: ['bench', 'trace'],
    },
    iterations: 20_000,
    name: 'typical trail',
    samples: 6,
    trail: typicalTrail,
  },
  {
    input: { jobId: 'job-1' },
    iterations: 250,
    name: 'mocked I/O trail',
    samples: 5,
    trail: ioTrail,
  },
];

const median = (values: readonly number[]): number => {
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted[middle] ?? 0;
};

const measureScenario = async (
  scenario: Scenario,
  sink: TraceSink
): Promise<number> => {
  registerTraceSink(sink);

  for (let i = 0; i < 250; i += 1) {
    await executeTrail(scenario.trail, scenario.input);
  }

  const startedAt = performance.now();
  for (let i = 0; i < scenario.iterations; i += 1) {
    await executeTrail(scenario.trail, scenario.input);
  }
  return performance.now() - startedAt;
};

const collectSamples = async (
  scenario: Scenario
): Promise<readonly Sample[]> => {
  const samples: Sample[] = [];

  for (let i = 0; i < scenario.samples; i += 1) {
    const baselineMs = await measureScenario(scenario, NOOP_SINK);
    const tracedMs = await measureScenario(scenario, wrappedNoopSink);
    const overheadPct = ((tracedMs - baselineMs) / baselineMs) * 100;
    samples.push({ baselineMs, overheadPct, tracedMs });
  }

  return samples;
};

const formatMs = (value: number): string => value.toFixed(2);
const formatPct = (value: number): string => `${value.toFixed(2)}%`;

const summarizeScenario = (
  scenario: Scenario,
  samples: readonly Sample[]
): {
  readonly baselineMs: number;
  readonly baselineUs: number;
  readonly overheadPct: number;
  readonly tracedMs: number;
  readonly tracedUs: number;
} => {
  const baselineMs = median(samples.map((sample) => sample.baselineMs));
  const tracedMs = median(samples.map((sample) => sample.tracedMs));
  const overheadPct = median(samples.map((sample) => sample.overheadPct));
  const baselineUs = (baselineMs * 1000) / scenario.iterations;
  const tracedUs = (tracedMs * 1000) / scenario.iterations;

  return {
    baselineMs,
    baselineUs,
    overheadPct,
    tracedMs,
    tracedUs,
  };
};

const printScenario = (
  scenario: Scenario,
  samples: readonly Sample[]
): void => {
  const summary = summarizeScenario(scenario, samples);

  console.log(`## ${scenario.name}`);
  console.log(`iterations: ${scenario.iterations}`);
  console.log(`samples: ${scenario.samples}`);
  console.log(
    `NOOP_SINK median: ${formatMs(summary.baselineMs)} ms (${summary.baselineUs.toFixed(2)} us/call)`
  );
  console.log(
    `wrapped no-op sink median: ${formatMs(summary.tracedMs)} ms (${summary.tracedUs.toFixed(2)} us/call)`
  );
  console.log(
    `overhead vs NOOP_SINK baseline: ${formatPct(summary.overheadPct)}`
  );
  console.log('');
};

console.log('# Intrinsic tracing benchmark');
console.log(`bun: ${Bun.version}`);
console.log(`timestamp: ${new Date().toISOString()}`);
console.log('');

for (const scenario of scenarios) {
  const samples = await collectSamples(scenario);
  printScenario(scenario, samples);
}
