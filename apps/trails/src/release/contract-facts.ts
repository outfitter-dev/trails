import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import type { WorkspaceInfo } from './check.js';

export type ContractReleaseFactAspect =
  | 'input'
  | 'output'
  | 'surfaces'
  | 'trail'
  | 'visibility';

export interface ContractReleaseFact {
  readonly aspect: ContractReleaseFactAspect;
  readonly baseHash: string | null;
  readonly changedFiles: readonly string[];
  readonly currentHash: string | null;
  readonly packageName?: string;
  readonly path: string;
  readonly trailId: string;
  readonly workspacePath?: string;
}

export interface ContractReleaseFactInput {
  readonly baseRef?: string;
  readonly changedFiles: readonly string[];
  readonly repoRoot: string;
  readonly workspaces: readonly WorkspaceInfo[];
}

export interface ContractSourceSnapshot {
  readonly baseSource: string | null;
  readonly changedFiles?: readonly string[];
  readonly currentSource: string | null;
  readonly packageName?: string;
  readonly path: string;
  readonly workspacePath?: string;
}

interface TrailDefinition {
  readonly aspects: Readonly<Record<ContractReleaseFactAspect, string | null>>;
  readonly trailId: string;
  readonly visibility: 'internal' | 'public';
}

const NON_SHIPPING_SOURCE_PATTERNS = [
  /(?:^|\/)__tests__(?:\/|$)/u,
  /(?:^|\/)__snapshots__(?:\/|$)/u,
  /(?:^|\/)dist(?:\/|$)/u,
  /(?:^|\/)\.turbo(?:\/|$)/u,
  /(?:^|\/)node_modules(?:\/|$)/u,
  /\.(?:test|spec|snap)\.[cm]?[jt]sx?$/u,
  /\.test-d\.ts$/u,
  /\.tsbuildinfo$/u,
] as const;

const SOURCE_PATH_PATTERN = /\.[cm]?[jt]sx?$/u;

const normalizePath = (path: string): string =>
  path.replaceAll('\\', '/').replace(/^\.\//u, '');

const isPublishableOnTrailsWorkspace = (workspace: WorkspaceInfo): boolean =>
  !workspace.isPrivate && workspace.name.startsWith('@ontrails/');

const isUnderWorkspace = (filePath: string, workspacePath: string): boolean =>
  filePath === workspacePath || filePath.startsWith(`${workspacePath}/`);

const getWorkspaceRelativePath = (
  filePath: string,
  workspacePath: string
): string => filePath.slice(workspacePath.length + 1);

const isNonShippingSourcePath = (workspaceRelativePath: string): boolean =>
  NON_SHIPPING_SOURCE_PATTERNS.some((pattern) =>
    pattern.test(workspaceRelativePath)
  );

const hashSource = (source: string | null): string | null =>
  source === null
    ? null
    : createHash('sha256').update(source).digest('hex').slice(0, 16);

const readCurrentSource = (
  repoRoot: string,
  relativePath: string
): string | null => {
  const absolutePath = join(repoRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null;
};

const readBaseSource = (
  repoRoot: string,
  baseRef: string | undefined,
  relativePath: string
): string | null => {
  if (!baseRef) {
    return null;
  }

  const result = Bun.spawnSync({
    cmd: ['git', 'show', `${baseRef}:${relativePath}`],
    cwd: repoRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  return result.exitCode === 0 ? result.stdout.toString() : null;
};

const workspaceForFile = (
  filePath: string,
  workspaces: readonly WorkspaceInfo[]
): WorkspaceInfo | undefined =>
  workspaces
    .filter(isPublishableOnTrailsWorkspace)
    .find((workspace) => isUnderWorkspace(filePath, workspace.relativePath));

export const createContractSourceSnapshots = (
  input: ContractReleaseFactInput
): readonly ContractSourceSnapshot[] => {
  const snapshots: ContractSourceSnapshot[] = [];

  for (const changedFile of input.changedFiles.map(normalizePath)) {
    if (!SOURCE_PATH_PATTERN.test(changedFile)) {
      continue;
    }

    const workspace = workspaceForFile(changedFile, input.workspaces);
    if (!workspace) {
      continue;
    }

    const workspaceRelativePath = getWorkspaceRelativePath(
      changedFile,
      workspace.relativePath
    );
    if (isNonShippingSourcePath(workspaceRelativePath)) {
      continue;
    }

    const baseSource = readBaseSource(
      input.repoRoot,
      input.baseRef,
      changedFile
    );
    const currentSource = readCurrentSource(input.repoRoot, changedFile);
    if (baseSource === null && currentSource === null) {
      continue;
    }

    snapshots.push({
      baseSource,
      changedFiles: [changedFile],
      currentSource,
      packageName: workspace.name,
      path: changedFile,
      workspacePath: workspace.relativePath,
    });
  }

  return snapshots;
};

const isPropertyNamed = (
  property: ts.ObjectLiteralElementLike,
  name: string
): property is ts.PropertyAssignment => {
  if (!ts.isPropertyAssignment(property)) {
    return false;
  }

  const propertyName = property.name;
  return (
    (ts.isIdentifier(propertyName) && propertyName.text === name) ||
    (ts.isStringLiteral(propertyName) && propertyName.text === name)
  );
};

const findProperty = (
  object: ts.ObjectLiteralExpression,
  name: string
): ts.PropertyAssignment | undefined =>
  object.properties.find((property) => isPropertyNamed(property, name));

const isTrailCall = (node: ts.CallExpression): boolean =>
  ts.isIdentifier(node.expression) && node.expression.text === 'trail';

const literalText = (node: ts.Expression | undefined): string | undefined =>
  node && ts.isStringLiteralLike(node) ? node.text : undefined;

const normalizeText = (value: string): string =>
  value.replaceAll(/\s+/gu, ' ').trim();

const normalizeExpressionText = (
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  constInitializers: ReadonlyMap<string, ts.Expression>
): string | null => {
  if (!expression) {
    return null;
  }

  if (ts.isIdentifier(expression)) {
    const initializer = constInitializers.get(expression.text);
    if (initializer) {
      return `${expression.text}=${normalizeText(
        initializer.getText(sourceFile)
      )}`;
    }
  }

  return normalizeText(expression.getText(sourceFile));
};

const visibilityFor = (
  object: ts.ObjectLiteralExpression
): TrailDefinition['visibility'] => {
  const visibility = findProperty(object, 'visibility');
  const value = literalText(visibility?.initializer);
  if (value === 'internal') {
    return 'internal';
  }
  return 'public';
};

const collectConstInitializers = (
  sourceFile: ts.SourceFile
): ReadonlyMap<string, ts.Expression> => {
  const initializers = new Map<string, ts.Expression>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      initializers.set(node.name.text, node.initializer);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return initializers;
};

const collectTrailDefinitions = (
  source: string
): readonly TrailDefinition[] => {
  const sourceFile = ts.createSourceFile(
    'release-contract-facts.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const constInitializers = collectConstInitializers(sourceFile);
  const definitions: TrailDefinition[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTrailCall(node)) {
      const [idArgument, spec] = node.arguments;
      const trailId = literalText(idArgument);

      if (trailId && spec && ts.isObjectLiteralExpression(spec)) {
        const visibility = visibilityFor(spec);
        definitions.push({
          aspects: {
            input: normalizeExpressionText(
              findProperty(spec, 'input')?.initializer,
              sourceFile,
              constInitializers
            ),
            output: normalizeExpressionText(
              findProperty(spec, 'output')?.initializer,
              sourceFile,
              constInitializers
            ),
            surfaces: normalizeExpressionText(
              findProperty(spec, 'surfaces')?.initializer,
              sourceFile,
              constInitializers
            ),
            trail: normalizeText(trailId),
            visibility,
          },
          trailId,
          visibility,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return definitions;
};

const definitionsById = (
  definitions: readonly TrailDefinition[]
): ReadonlyMap<string, TrailDefinition> =>
  new Map(definitions.map((definition) => [definition.trailId, definition]));

const isPublicContract = (definition: TrailDefinition | undefined): boolean =>
  definition !== undefined && definition.visibility !== 'internal';

const fact = (
  snapshot: ContractSourceSnapshot,
  trailId: string,
  aspect: ContractReleaseFactAspect,
  baseValue: string | null,
  currentValue: string | null
): ContractReleaseFact => ({
  aspect,
  baseHash: hashSource(baseValue),
  changedFiles: snapshot.changedFiles ?? [snapshot.path],
  currentHash: hashSource(currentValue),
  ...(snapshot.packageName ? { packageName: snapshot.packageName } : {}),
  path: snapshot.path,
  trailId,
  ...(snapshot.workspacePath ? { workspacePath: snapshot.workspacePath } : {}),
});

const compareDefinitions = (
  snapshot: ContractSourceSnapshot,
  baseDefinition: TrailDefinition | undefined,
  currentDefinition: TrailDefinition | undefined
): readonly ContractReleaseFact[] => {
  if (
    !isPublicContract(baseDefinition) &&
    !isPublicContract(currentDefinition)
  ) {
    return [];
  }

  const trailId =
    currentDefinition?.trailId ?? baseDefinition?.trailId ?? '(unknown)';

  if (!baseDefinition || !currentDefinition) {
    return [
      fact(
        snapshot,
        trailId,
        'trail',
        baseDefinition?.aspects.trail ?? null,
        currentDefinition?.aspects.trail ?? null
      ),
    ];
  }

  const facts: ContractReleaseFact[] = [];

  for (const aspect of ['input', 'output', 'surfaces'] as const) {
    const baseValue = baseDefinition.aspects[aspect];
    const currentValue = currentDefinition.aspects[aspect];
    if (baseValue !== currentValue) {
      facts.push(fact(snapshot, trailId, aspect, baseValue, currentValue));
    }
  }

  if (baseDefinition.visibility !== currentDefinition.visibility) {
    facts.push(
      fact(
        snapshot,
        trailId,
        'visibility',
        baseDefinition.visibility,
        currentDefinition.visibility
      )
    );
  }

  return facts;
};

export const findPublicTrailContractChangeFactsFromSnapshots = (
  snapshots: readonly ContractSourceSnapshot[]
): readonly ContractReleaseFact[] => {
  const facts: ContractReleaseFact[] = [];

  for (const snapshot of snapshots) {
    const baseDefinitions = definitionsById(
      snapshot.baseSource === null
        ? []
        : collectTrailDefinitions(snapshot.baseSource)
    );
    const currentDefinitions = definitionsById(
      snapshot.currentSource === null
        ? []
        : collectTrailDefinitions(snapshot.currentSource)
    );
    const trailIds = new Set([
      ...baseDefinitions.keys(),
      ...currentDefinitions.keys(),
    ]);

    for (const trailId of [...trailIds].toSorted()) {
      facts.push(
        ...compareDefinitions(
          snapshot,
          baseDefinitions.get(trailId),
          currentDefinitions.get(trailId)
        )
      );
    }
  }

  return facts.toSorted(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.trailId.localeCompare(right.trailId) ||
      left.aspect.localeCompare(right.aspect)
  );
};

export const findPublicTrailContractChangeFacts = (
  input: ContractReleaseFactInput
): readonly ContractReleaseFact[] =>
  findPublicTrailContractChangeFactsFromSnapshots(
    createContractSourceSnapshots(input)
  );
