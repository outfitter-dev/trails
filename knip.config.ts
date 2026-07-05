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
  ...packageWorkspaceDirs('examples').map(
    (workspace) => [workspace, createAppWorkspace(workspace)] as const
  ),
];

const workspaceMap = Object.fromEntries(workspaceEntries);

// `@ontrails/testing` exposes the surface harnesses behind subpaths
// (`./cli`, `./mcp`, `./http`) and marks the surface peers optional via
// `peerDependenciesMeta`. The subpath modules statically import those peers
// because consumers opt into them by importing the matching subpath; knip's
// "Referenced optional peerDependencies" hint is intentional in this layout.
const testingWorkspace = 'packages/testing';
const testingWorkspaceEntry = workspaceMap[testingWorkspace];
if (testingWorkspaceEntry) {
  workspaceMap[testingWorkspace] = {
    ...testingWorkspaceEntry,
    ignoreDependencies: ['@ontrails/cli', '@ontrails/http', '@ontrails/mcp'],
  };
}

// The lock-overlays proof test writes a fixture app whose source string
// imports `@ontrails/cloudflare`; the devDependency exists so that fixture
// resolves at runtime, but knip cannot see imports inside string literals.
const trailsAppWorkspace = 'apps/trails';
const trailsAppWorkspaceEntry = workspaceMap[trailsAppWorkspace];
if (trailsAppWorkspaceEntry) {
  workspaceMap[trailsAppWorkspace] = {
    ...trailsAppWorkspaceEntry,
    ignoreDependencies: ['@ontrails/cloudflare'],
  };
}

const config: KnipConfig = {
  ignoreExportsUsedInFile: true,
  treatConfigHintsAsErrors: true,
  workspaces: {
    '.': {
      entry: [
        'scripts/bootstrap/main.ts',
        'scripts/verify-oxc-resolver-published.ts',
        'scripts/__tests__/**/*.ts',
        'trails.config.ts',
      ],
      project: ['scripts/**/*.ts'],
    },
    ...workspaceMap,
  },
};

export default config;
