import { afterEach, describe, expect, test } from 'bun:test';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { InternalError, Result, ValidationError } from '@ontrails/core';

import { scaffoldDependencyVersions } from '../scaffold-versions.generated.js';
import { addSurface } from '../trails/add-surface.js';
import { createTrail } from '../trails/create.js';
import { createScaffold } from '../trails/create-scaffold.js';

const roots: string[] = [];
const temporaryProject = (): string => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'trails-bun-rerun-')));
  roots.push(parent);
  return join(parent, 'app');
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const snapshot = (root: string, relative = ''): unknown[] =>
  readdirSync(join(root, relative))
    .toSorted()
    .map((name) => {
      const path = join(relative, name);
      const stat = lstatSync(join(root, path));
      return [
        path,
        stat.mode,
        stat.mtimeMs,
        stat.isDirectory()
          ? snapshot(root, path)
          : readFileSync(join(root, path)).toString('base64'),
      ];
    });

const runCreate = (root: string, workspace: boolean, dryRun = false) =>
  createTrail.implementation(
    {
      dir: dirname(root),
      name: basename(root),
      starter: 'hello',
      surfaces: ['cli'],
      verify: false,
      workspace,
    },
    {
      compose: async (id: string, input: unknown) => {
        if (id === 'create.scaffold') {
          return createScaffold.implementation(input as never, {} as never);
        }
        if (id === 'add.surface') {
          return addSurface.implementation(input as never, {} as never);
        }
        return Result.err(
          new InternalError(`Unexpected compose target: ${id}`)
        );
      },
      dryRun,
    } as never
  );

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const setBunPin = (appRoot: string, pin: string): void => {
  const path = join(appRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.devDependencies['@types/bun'] = pin;
  manifest.devDependencies['custom-dev'] = '1.0.0';
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
};

describe.each(['standalone', 'workspace'] as const)(
  '%s Bun types scaffold reruns',
  (layout) => {
    const workspace = layout === 'workspace';

    test('upgrades only the authored prior generated range after a no-write preview', async () => {
      const root = temporaryProject();
      const created = expectOk(await runCreate(root, workspace));
      const appRoot = created.appDir;
      setBunPin(appRoot, '^1.4.3');
      const before = snapshot(root);
      const appSource = readFileSync(join(appRoot, 'src/app.ts'), 'utf8');

      expectOk(await runCreate(root, workspace, true));
      expect(snapshot(root)).toEqual(before);

      expectOk(await runCreate(root, workspace));
      const manifest = JSON.parse(
        readFileSync(join(appRoot, 'package.json'), 'utf8')
      );
      expect(manifest.devDependencies['@types/bun']).toBe(
        scaffoldDependencyVersions.bunTypes
      );
      expect(manifest.devDependencies['custom-dev']).toBe('1.0.0');
      expect(readFileSync(join(appRoot, 'src/app.ts'), 'utf8')).toBe(appSource);

      const currentManifest = readFileSync(
        join(appRoot, 'package.json'),
        'utf8'
      );
      expectOk(await runCreate(root, workspace));
      expect(readFileSync(join(appRoot, 'package.json'), 'utf8')).toBe(
        currentManifest
      );
    });

    test.each([
      '~1.4.3',
      '1.4.3',
      '^1.4.5',
      '^1.4.2',
      '^1.3.11',
      'latest',
      'workspace:*',
      'https://example.invalid/types.tgz',
    ])(
      'rejects customized or unsupported prior Bun types %s without writing',
      async (pin) => {
        const root = temporaryProject();
        const created = expectOk(await runCreate(root, workspace));
        setBunPin(created.appDir, pin);
        rmSync(join(created.appDir, 'tsconfig.json'));
        const before = snapshot(root);

        for (const dryRun of [true, false]) {
          const result = await runCreate(root, workspace, dryRun);
          expect(result.isErr()).toBe(true);
          if (result.isErr()) {
            expect(result.error).toBeInstanceOf(ValidationError);
            expect(result.error.message).toContain(
              'Cannot reconcile the existing app package.json'
            );
          }
          expect(snapshot(root)).toEqual(before);
        }
      }
    );
  }
);
