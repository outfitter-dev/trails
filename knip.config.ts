import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { KnipConfig } from 'knip';

type WorkspaceConfig = NonNullable<KnipConfig['workspaces']>[string];

const ifFile = (workspace: string, pattern: string): string[] =>
  existsSync(join(workspace, pattern)) ? [pattern] : [];

const ifDirectory = (
  workspace: string,
  directory: string,
  pattern: string
): string[] => (existsSync(join(workspace, directory)) ? [pattern] : []);

const packageWorkspaceDirs = (base: string): string[] => {
  if (!existsSync(base)) {
    throw new Error(
      `knip config expected workspace directory "${base}" to exist`
    );
  }
  return readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(base, entry.name, 'package.json'))
    )
    .map((entry) => `${base}/${entry.name}`)
    .toSorted();
};

const createLibraryWorkspace = (workspace: string): WorkspaceConfig => ({
  entry: [
    ...ifFile(workspace, 'src/type-checks.test-d.ts'),
    ...ifDirectory(workspace, 'src/__tests__', 'src/__tests__/**/*.ts'),
    ...ifDirectory(workspace, 'bin', 'bin/**/*.ts'),
    ...ifDirectory(workspace, 'scripts', 'scripts/**/*.ts'),
    ...ifDirectory(workspace, '__tests__', '__tests__/**/*.ts'),
  ],
  project: [
    ...ifDirectory(workspace, 'src', 'src/**/*.ts'),
    ...ifDirectory(workspace, 'bin', 'bin/**/*.ts'),
    ...ifDirectory(workspace, 'scripts', 'scripts/**/*.ts'),
    ...ifDirectory(workspace, '__tests__', '__tests__/**/*.ts'),
  ],
});

const createAppWorkspace = (workspace: string): WorkspaceConfig => ({
  entry: [
    ...ifDirectory(workspace, 'bin', 'bin/**/*.ts'),
    ...ifFile(workspace, 'src/mcp.ts'),
    ...ifDirectory(workspace, 'src/__tests__', 'src/__tests__/**/*.ts'),
    ...ifDirectory(workspace, '__tests__', '__tests__/**/*.ts'),
  ],
  project: [
    ...ifDirectory(workspace, 'src', 'src/**/*.ts'),
    ...ifDirectory(workspace, 'bin', 'bin/**/*.ts'),
    ...ifDirectory(workspace, '__tests__', '__tests__/**/*.ts'),
  ],
});

const workspaceEntries = [
  ...packageWorkspaceDirs('packages').map(
    (workspace) => [workspace, createLibraryWorkspace(workspace)] as const
  ),
  ...packageWorkspaceDirs('adapters').map(
    (workspace) => [workspace, createLibraryWorkspace(workspace)] as const
  ),
  ...packageWorkspaceDirs('apps').map(
    (workspace) => [workspace, createAppWorkspace(workspace)] as const
  ),
];

const config: KnipConfig = {
  ignoreExportsUsedInFile: true,
  treatConfigHintsAsErrors: true,
  workspaces: {
    '.': {
      entry: [
        'scripts/adr.ts',
        'scripts/bootstrap/main.ts',
        'scripts/verify-oxc-resolver-published.ts',
        'scripts/__tests__/**/*.ts',
        'trails.config.ts',
      ],
      project: ['scripts/**/*.ts'],
    },
    ...Object.fromEntries(workspaceEntries),
  },
};

export default config;
