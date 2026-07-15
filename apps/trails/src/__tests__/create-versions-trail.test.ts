import { deriveCliCommands } from '@ontrails/cli';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { app } from '../app.js';
import {
  diagnoseOntrailsPackagePin,
  syncScaffoldVersions,
} from '../scaffold-version-sync.js';
import { createVersionsTrail } from '../trails/create-versions.js';

const roots: string[] = [];

const fixturePackageJson = {
  catalog: {
    commander: '^14.0.0',
    zod: '^4.0.0',
  },
  devDependencies: {
    '@types/bun': '^1.0.0',
    lefthook: '^2.0.0',
    oxfmt: '0.1.0',
    oxlint: '1.0.0',
    typescript: '^5.0.0',
    ultracite: '7.0.0',
  },
  name: 'fixture-root',
};

const expectedGeneratedContent = [
  '// GENERATED FILE — do not edit by hand. Run `bun run scaffold-versions:sync` to regenerate.',
  '',
  'export const scaffoldDependencyVersions = {',
  "  bunTypes: '^1.0.0',",
  "  commander: '^14.0.0',",
  "  lefthook: '^2.0.0',",
  "  oxfmt: '0.1.0',",
  "  oxlint: '1.0.0',",
  "  typescript: '^5.0.0',",
  "  ultracite: '7.0.0',",
  "  zod: '^4.0.0',",
  '} as const;',
  '',
].join('\n');

const makeTempRoot = (
  packageJson: Record<string, unknown> = fixturePackageJson
): string => {
  const root = mkdtempSync(join(tmpdir(), 'trails-create-versions-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  );
  mkdirSync(join(root, 'apps/trails/src'), { recursive: true });
  return root;
};

const implementation = async (input: { check: boolean; rootDir: string }) =>
  await createVersionsTrail.implementation(input, {
    cwd: input.rootDir,
    env: { TRAILS_ENV: 'test' },
  } as never);

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('diagnoseOntrailsPackagePin', () => {
  test('accepts exact generated @ontrails package pins', () => {
    expect(
      diagnoseOntrailsPackagePin({
        ontrailsPackageRange: '1.0.0-beta.18',
        trailsPackageVersion: '1.0.0-beta.18',
      })
    ).toBeUndefined();
  });

  test('rejects caret prerelease ranges for generated @ontrails packages', () => {
    expect(
      diagnoseOntrailsPackagePin({
        ontrailsPackageRange: '^1.0.0-beta.18',
        trailsPackageVersion: '1.0.0-beta.18',
      })
    ).toContain('must be exact pins');
  });

  test('rejects plain version drift for generated @ontrails packages', () => {
    expect(
      diagnoseOntrailsPackagePin({
        ontrailsPackageRange: '1.0.0-beta.17',
        trailsPackageVersion: '1.0.0-beta.18',
      })
    ).toContain('must be exact pins');
  });

  test('requires both scaffold version exports', () => {
    expect(diagnoseOntrailsPackagePin({})).toContain(
      'must export `ontrailsPackageRange` and `trailsPackageVersion`'
    );
  });
});

describe('create.versions trail', () => {
  test('renders as a nested CLI command', () => {
    const commands = deriveCliCommands(app);
    if (commands.isErr()) {
      throw commands.error;
    }

    const paths = commands.value.map((command) => command.path.join(' '));
    expect(paths).toContain('create versions');
  });

  test('writes the generated file from root package.json versions', async () => {
    const root = makeTempRoot();

    const result = await implementation({ check: false, rootDir: root });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toEqual({
      generatedPath: join(
        root,
        'apps/trails/src/scaffold-versions.generated.ts'
      ),
      mode: 'write',
      written: true,
    });
    expect(
      readFileSync(
        join(root, 'apps/trails/src/scaffold-versions.generated.ts'),
        'utf8'
      )
    ).toBe(expectedGeneratedContent);
  });

  test('check mode passes when the generated file is current', async () => {
    const root = makeTempRoot();
    await syncScaffoldVersions({ check: false, rootDir: root });

    const result = await implementation({ check: true, rootDir: root });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toEqual({
      generatedPath: join(
        root,
        'apps/trails/src/scaffold-versions.generated.ts'
      ),
      mode: 'check',
      written: false,
    });
  });

  test('check mode reports drift when the generated file is missing', async () => {
    const root = makeTempRoot();

    const result = await implementation({ check: true, rootDir: root });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('expected check mode to fail without a generated file');
    }
    expect(result.error.message).toContain('scaffold-versions:sync');
  });

  test('reports missing devDependency entries from root package.json', async () => {
    const { lefthook: _omitted, ...devDependencies } =
      fixturePackageJson.devDependencies;
    const root = makeTempRoot({ ...fixturePackageJson, devDependencies });

    const result = await implementation({ check: false, rootDir: root });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('expected missing lefthook entry to fail');
    }
    expect(result.error.message).toContain('missing "lefthook"');
  });
});
