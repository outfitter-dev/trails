/**
 * The README quickstart must execute verbatim on a fresh checkout. This runs
 * the committed quickstart.ts (the library hero snippet) and the CLI
 * invocation exactly as the README shows them.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const appRoot = join(import.meta.dir, '..', '..');

const runInAppRoot = async (
  cmd: string[]
): Promise<{ exitCode: number; stdout: string }> => {
  const proc = Bun.spawn(cmd, { cwd: appRoot, stderr: 'pipe', stdout: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
};

describe('README quickstart', () => {
  test('quickstart.ts evaluates checkout-v2 through the library surface', async () => {
    const { exitCode, stdout } = await runInAppRoot(['bun', 'quickstart.ts']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('checkout-v2');
    expect(stdout).toContain('treatment');
  });

  test('the CLI invocation from the README works verbatim', async () => {
    const { exitCode, stdout } = await runInAppRoot([
      'bun',
      'bin/switchback.ts',
      'flag',
      'evaluate',
      'checkout-v2',
      '{"context":{"subjectId":"user-1"}}',
      '--explain',
    ]);
    expect(exitCode).toBe(0);
    const evaluation = JSON.parse(stdout) as {
      explanation: string[];
      reason: { reason: string };
      value: string;
    };
    expect(evaluation.value).toBe('treatment');
    expect(evaluation.reason.reason).toBe('percentage-rollout');
    expect(evaluation.explanation.at(-1)).toBe(
      'result: "treatment" (percentage-rollout)'
    );
  });
});
