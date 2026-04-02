/**
 * `add.verify` trail -- Add testing + warden setup to a project.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Content generators
// ---------------------------------------------------------------------------

const generateTestFile = (): string =>
  `import { testAll } from '@ontrails/testing';
import { app } from '../src/app.js';

testAll(app);
`;

const generateLefthookYml = (): string =>
  `pre-push:
  commands:
    warden:
      run: bunx trails warden --exit-code
`;

/** Add testing and warden devDependencies to package.json when present. */
const patchVerifyDeps = (pkg: Record<string, unknown>): void => {
  const devDeps = (pkg['devDependencies'] ?? {}) as Record<string, string>;
  devDeps['@ontrails/testing'] = 'workspace:*';
  devDeps['@ontrails/warden'] = 'workspace:*';
  devDeps['lefthook'] = '^2.1.1';
  pkg['devDependencies'] = Object.fromEntries(
    Object.entries(devDeps).toSorted(([a], [b]) => a.localeCompare(b))
  );
};

/** Update package.json in the target project with verify dependencies. */
const updatePackageJsonForVerify = async (
  projectDir: string
): Promise<void> => {
  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) {
    return;
  }
  const pkg = (await Bun.file(pkgPath).json()) as Record<string, unknown>;
  patchVerifyDeps(pkg);
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const addVerify = trail('add.verify', {
  blaze: async (input) => {
    const projectDir = resolve(input.dir ?? '.', input.name);
    const files: string[] = [];

    const writeFile = async (
      relativePath: string,
      content: string
    ): Promise<void> => {
      const fullPath = join(projectDir, relativePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      await Bun.write(fullPath, content);
      files.push(relativePath);
    };

    await writeFile('__tests__/examples.test.ts', generateTestFile());
    await writeFile('lefthook.yml', generateLefthookYml());
    await updatePackageJsonForVerify(projectDir);

    return Result.ok({ created: files });
  },
  description: 'Add testing and warden verification',
  input: z.object({
    dir: z.string().optional().describe('Parent directory'),
    name: z.string().describe('Project name'),
  }),
  metadata: { internal: true },
  output: z.object({
    created: z.array(z.string()),
  }),
});
