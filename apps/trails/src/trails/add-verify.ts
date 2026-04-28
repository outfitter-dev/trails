/**
 * `add.verify` trail -- Add testing + warden setup to a project.
 */

import { existsSync } from 'node:fs';

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  PROJECT_NAME_MESSAGE,
  PROJECT_NAME_PATTERN,
  resolveProjectDir,
  resolveProjectPath,
  writeProjectFile,
} from '../project-writes.js';
import {
  ontrailsPackageRange,
  scaffoldDependencyVersions,
} from '../versions.js';

// ---------------------------------------------------------------------------
// Content generators
// ---------------------------------------------------------------------------

const generateTestFile = (): string =>
  `import { testAllEstablished } from '@ontrails/testing';
import { app } from '../src/app.js';

testAllEstablished(app);
`;

const generateLefthookYml = (): string =>
  `pre-push:
  commands:
    warden:
      run: bunx trails warden
`;

/** Add testing and warden devDependencies to package.json when present. */
const patchVerifyDeps = (pkg: Record<string, unknown>): void => {
  const devDeps = (pkg['devDependencies'] ?? {}) as Record<string, string>;
  devDeps['@ontrails/testing'] = ontrailsPackageRange;
  devDeps['@ontrails/warden'] = ontrailsPackageRange;
  devDeps['lefthook'] = scaffoldDependencyVersions.lefthook;
  pkg['devDependencies'] = Object.fromEntries(
    Object.entries(devDeps).toSorted(([a], [b]) => a.localeCompare(b))
  );
};

/** Update package.json in the target project with verify dependencies. */
const updatePackageJsonForVerify = async (
  projectDir: string
): Promise<Result<void, Error>> => {
  const pkgPathResult = resolveProjectPath(projectDir, 'package.json');
  if (pkgPathResult.isErr()) {
    return Result.err(pkgPathResult.error);
  }

  const pkgPath = pkgPathResult.value;
  if (!existsSync(pkgPath)) {
    return Result.ok();
  }
  const pkg = (await Bun.file(pkgPath).json()) as Record<string, unknown>;
  patchVerifyDeps(pkg);
  const written = await writeProjectFile(
    projectDir,
    'package.json',
    `${JSON.stringify(pkg, null, 2)}\n`
  );
  return written.isErr() ? Result.err(written.error) : Result.ok();
};

// ---------------------------------------------------------------------------
// Trail definition
// ---------------------------------------------------------------------------

export const addVerify = trail('add.verify', {
  blaze: async (input) => {
    const projectDirResult = resolveProjectDir(input.dir ?? '.', input.name);
    if (projectDirResult.isErr()) {
      return Result.err(projectDirResult.error);
    }

    const projectDir = projectDirResult.value;
    const files: string[] = [];

    const writeFile = async (
      relativePath: string,
      content: string
    ): Promise<Result<void, Error>> => {
      const written = await writeProjectFile(projectDir, relativePath, content);
      if (written.isErr()) {
        return Result.err(written.error);
      }
      files.push(written.value);
      return Result.ok();
    };

    const testFile = await writeFile(
      '__tests__/examples.test.ts',
      generateTestFile()
    );
    if (testFile.isErr()) {
      return Result.err(testFile.error);
    }

    const lefthookFile = await writeFile('lefthook.yml', generateLefthookYml());
    if (lefthookFile.isErr()) {
      return Result.err(lefthookFile.error);
    }

    const packageResult = await updatePackageJsonForVerify(projectDir);
    if (packageResult.isErr()) {
      return Result.err(packageResult.error);
    }

    return Result.ok({ created: files });
  },
  description: 'Add testing and warden verification',
  input: z.object({
    dir: z.string().optional().describe('Parent directory'),
    name: z
      .string()
      .regex(PROJECT_NAME_PATTERN, PROJECT_NAME_MESSAGE)
      .describe('Project name'),
  }),
  meta: { internal: true },
  output: z.object({
    created: z.array(z.string()),
  }),
});
