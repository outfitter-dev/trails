import {
  isInsideWorkspace,
  isPlainObject,
  listWorkspacePackageDirs,
  listWorkspacePackages,
  listWorkspacePatterns,
} from '@ontrails/core';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { TransitionChange, TransitionDiagnostic } from './types.ts';

export interface ManifestDocument {
  readonly before: string;
  readonly file: string;
  readonly manifest: Record<string, unknown>;
}

export interface ConsumerWorkspace {
  readonly changes: readonly TransitionChange[];
  readonly diagnostics: readonly TransitionDiagnostic[];
  readonly documents: readonly ManifestDocument[];
  readonly localPackages: ReadonlySet<string>;
  readonly publicPackages: ReadonlySet<string>;
  readonly rootDocument: ManifestDocument;
}

const readManifest = (file: string): ManifestDocument => {
  const before = readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(before);
  } catch {
    throw new Error(`${file} must contain valid JSON.`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${file} must contain a JSON object.`);
  }
  return { before, file, manifest: parsed };
};

const derivePublicPackageNames = (trailsRoot: string): ReadonlySet<string> =>
  new Set(
    listWorkspacePackages<{ name?: unknown; private?: unknown }>(trailsRoot)
      .map(({ manifest }) => manifest)
      .filter(
        (manifest) =>
          manifest.private !== true &&
          typeof manifest.name === 'string' &&
          manifest.name.startsWith('@ontrails/')
      )
      .map((manifest) => manifest.name as string)
  );

const isWithinRoot = (packageRoot: string, root: string): boolean =>
  packageRoot === root || isInsideWorkspace(packageRoot, root);

const readRootManifest = (root: string): ManifestDocument => {
  const file = join(root, 'package.json');
  const realFile = realpathSync(file).replaceAll('\\', '/');
  if (!isWithinRoot(realFile, root)) {
    throw new TypeError(
      `Refusing to read consumer manifest outside ${root}: ${file}`
    );
  }
  return readManifest(realFile);
};

const validateWorkspaceConfiguration = (
  rootDocument: ManifestDocument
): void => {
  const { workspaces } = rootDocument.manifest;
  if (workspaces === undefined) {
    return;
  }
  let patterns: readonly unknown[] | undefined;
  if (Array.isArray(workspaces)) {
    patterns = workspaces;
  } else if (
    isPlainObject(workspaces) &&
    Array.isArray(workspaces['packages'])
  ) {
    patterns = workspaces['packages'];
  }
  if (!patterns || patterns.some((pattern) => typeof pattern !== 'string')) {
    throw new Error(
      `${rootDocument.file} workspaces must be a string array or an object with a string packages array.`
    );
  }
  for (const pattern of patterns) {
    const hasGlobSyntax = /[*?![\]{}]/u.test(pattern);
    const isSimpleChildGlob = /^[^*?![\]{}]+\/\*$/u.test(pattern);
    if (hasGlobSyntax && !isSimpleChildGlob) {
      throw new TypeError(
        `${rootDocument.file} uses unsupported workspace pattern ${pattern}. Only exact paths and simple dir/* patterns are supported.`
      );
    }
  }
};

const validateWorkspaceManifests = (
  root: string,
  rootDocument: ManifestDocument
): void => {
  for (const packageRoot of listWorkspacePackageDirs(
    root,
    listWorkspacePatterns(rootDocument.manifest)
  )) {
    const document = readManifest(join(packageRoot, 'package.json'));
    if (typeof document.manifest['name'] !== 'string') {
      throw new TypeError(
        `${document.file} must declare a string package name before migration.`
      );
    }
  }
};

const discoverExternalSymlinkWorkspaces = ({
  publicPackages,
  root,
  rootDocument,
}: {
  readonly publicPackages: ReadonlySet<string>;
  readonly root: string;
  readonly rootDocument: ManifestDocument;
}): readonly { readonly name: string; readonly packageRoot: string }[] =>
  listWorkspacePatterns(rootDocument.manifest).flatMap((pattern) => {
    if (!pattern.endsWith('/*')) {
      return [];
    }
    const parent = resolve(root, pattern.slice(0, -2));
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(parent, { encoding: 'utf8', withFileTypes: true });
    } catch {
      return [];
    }
    return entries.flatMap((entry) => {
      if (!entry.isSymbolicLink()) {
        return [];
      }
      try {
        const packageRoot = realpathSync(join(parent, entry.name)).replaceAll(
          '\\',
          '/'
        );
        if (isWithinRoot(packageRoot, root)) {
          return [];
        }
        const manifest: unknown = JSON.parse(
          readFileSync(join(packageRoot, 'package.json'), 'utf8')
        );
        return isPlainObject(manifest) &&
          typeof manifest['name'] === 'string' &&
          publicPackages.has(manifest['name'])
          ? [{ name: manifest['name'], packageRoot }]
          : [];
      } catch {
        return [];
      }
    });
  });

const detachExternalWorkspaces = ({
  externalWorkspaces,
  rootDocument,
}: {
  readonly externalWorkspaces: readonly {
    readonly name: string;
    readonly packageRoot: string;
  }[];
  readonly rootDocument: ManifestDocument;
}): {
  readonly changes: readonly TransitionChange[];
  readonly diagnostics: readonly TransitionDiagnostic[];
} => {
  const { workspaces } = rootDocument.manifest;
  if (!Array.isArray(workspaces)) {
    return {
      changes: [],
      diagnostics: externalWorkspaces.map(({ name }) => ({
        file: rootDocument.file,
        message: `External Trails workspace ${name} uses an unsupported workspace shape; detach it manually.`,
        name,
      })),
    };
  }
  const externalByRoot = new Map(
    externalWorkspaces.map(({ name, packageRoot }) => [packageRoot, name])
  );
  const detached = new Set<string>();
  const changes: TransitionChange[] = [];
  rootDocument.manifest['workspaces'] = workspaces.filter((entry: unknown) => {
    if (typeof entry !== 'string' || entry.includes('*')) {
      return true;
    }
    try {
      const candidate = realpathSync(
        resolve(resolve(rootDocument.file, '..'), entry)
      );
      const name = externalByRoot.get(candidate.replaceAll('\\', '/'));
      if (!name) {
        return true;
      }
      detached.add(name);
      changes.push({
        field: 'workspaces',
        file: rootDocument.file,
        from: entry,
        kind: 'remove',
        name,
      });
      return false;
    } catch {
      return true;
    }
  });
  const diagnostics = externalWorkspaces.flatMap(({ name }) =>
    detached.has(name)
      ? []
      : [
          {
            file: rootDocument.file,
            message: `External Trails workspace ${name} is reached through a glob or ambiguous workspace entry; detach it manually.`,
            name,
          },
        ]
  );
  return { changes, diagnostics };
};

export const discoverConsumerWorkspace = ({
  consumerRoot,
  trailsRoot,
}: {
  readonly consumerRoot: string;
  readonly trailsRoot: string;
}): ConsumerWorkspace => {
  const root = realpathSync(resolve(consumerRoot));
  const rootDocument = readRootManifest(root);
  validateWorkspaceConfiguration(rootDocument);
  validateWorkspaceManifests(root, rootDocument);
  const publicPackages = derivePublicPackageNames(resolve(trailsRoot));
  const workspaces = listWorkspacePackages<{
    name?: unknown;
    private?: unknown;
  }>(root);
  const escapedWorkspaceManifests = workspaces.filter(
    ({ packageJsonPath, packageRoot }) =>
      isWithinRoot(packageRoot, root) && !isWithinRoot(packageJsonPath, root)
  );
  const localWorkspaces = workspaces.filter(
    ({ packageJsonPath, packageRoot }) =>
      isWithinRoot(packageRoot, root) && isWithinRoot(packageJsonPath, root)
  );
  const localPackages = new Set(
    localWorkspaces.flatMap(({ manifest }) =>
      typeof manifest.name === 'string' ? [manifest.name] : []
    )
  );
  const externalWorkspaces = [
    ...workspaces.flatMap(({ manifest, packageRoot }) =>
      !isWithinRoot(packageRoot, root) &&
      typeof manifest.name === 'string' &&
      publicPackages.has(manifest.name)
        ? [{ name: manifest.name, packageRoot }]
        : []
    ),
    ...discoverExternalSymlinkWorkspaces({
      publicPackages,
      root,
      rootDocument,
    }),
  ].filter(
    (workspace, index, all) =>
      all.findIndex(
        ({ packageRoot }) => packageRoot === workspace.packageRoot
      ) === index
  );
  const documents = [
    rootDocument,
    ...localWorkspaces
      .filter(({ packageJsonPath }) => packageJsonPath !== rootDocument.file)
      .map(({ packageJsonPath }) => readManifest(packageJsonPath)),
  ].toSorted((left, right) => left.file.localeCompare(right.file));
  const detachment = detachExternalWorkspaces({
    externalWorkspaces,
    rootDocument,
  });
  return {
    ...detachment,
    diagnostics: [
      ...detachment.diagnostics,
      ...escapedWorkspaceManifests.map(({ manifest, packageJsonPath }) => ({
        file: rootDocument.file,
        message: `Workspace manifest resolves outside the selected consumer root: ${packageJsonPath}`,
        name: typeof manifest.name === 'string' ? manifest.name : undefined,
      })),
    ],
    documents,
    localPackages,
    publicPackages,
    rootDocument,
  };
};
