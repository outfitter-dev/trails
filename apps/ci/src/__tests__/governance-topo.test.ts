import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { runCiGovernance } from '../governance.js';

const repoTempDir = (): string =>
  join(
    resolve(import.meta.dir, '../..'),
    '.tmp-tests',
    `ci-governance-topo-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

const writePermitFixture = (dir: string): void => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    `import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

const destroyTrail = trail('entity.delete', {
  blaze: async () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'destroy',
  output: z.object({ ok: z.boolean() }),
});

export const app = topo('permit-ci-fixture', { destroyTrail });
`
  );
};

describe('runCiGovernance topo loading', () => {
  test('surfaces permit governance when an app topo is discoverable', async () => {
    const dir = repoTempDir();

    try {
      writePermitFixture(dir);

      const result = await runCiGovernance({
        failOn: 'error',
        format: 'json',
        rootDir: dir,
      });

      expect(result.passed).toBe(false);
      expect(result.errorCount).toBeGreaterThan(0);
      expect(result.output).toContain('permit.destroyWithoutPermit');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
