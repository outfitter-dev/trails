import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  Result,
  ValidationError,
  deriveDraftReport,
  isDraftId,
  trail,
} from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import {
  DRAFT_FILE_PREFIX,
  isDraftMarkedFile,
  stripDraftFileMarkers,
} from '@ontrails/warden';
import { findStringLiterals, parse } from '@ontrails/warden/ast';
import { z } from 'zod';

import {
  applyProjectOperations,
  planProjectOperations,
} from '../project-writes.js';
import type {
  PlannedProjectOperation,
  ProjectWriteOperation,
} from '../project-writes.js';
import { loadFreshAppLease } from './load-app.js';
import { findTopoPath } from './project.js';

interface PromotionEdit {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
}

interface FileRename {
  readonly from: string;
  readonly to: string;
}

const isManagedSourceFile = (match: string): boolean =>
  !match.endsWith('.d.ts') &&
  !match.startsWith('node_modules/') &&
  !match.startsWith('dist/') &&
  !match.startsWith('.git/');

const collectTsFiles = (rootDir: string): string[] => {
  const files: string[] = [];
  for (const match of new Bun.Glob('**/*.ts').scanSync({
    cwd: rootDir,
    dot: false,
    onlyFiles: true,
  })) {
    if (isManagedSourceFile(match)) {
      files.push(join(rootDir, match));
    }
  }
  return files.toSorted();
};

const applyEdits = (
  sourceCode: string,
  edits: readonly PromotionEdit[]
): string => {
  let updated = sourceCode;
  for (const edit of [...edits].toSorted((a, b) => b.start - a.start)) {
    updated =
      updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
  }
  return updated;
};

const literalQuote = (raw: string): '"' | "'" | '`' => {
  const [first] = raw;
  return first === '"' || first === '`' ? first : "'";
};

const replaceQuotedLiteral = (
  sourceCode: string,
  start: number,
  end: number,
  nextValue: string
): string => {
  const quote = literalQuote(sourceCode.slice(start, end));
  return `${quote}${nextValue}${quote}`;
};

const replaceIdLiterals = (
  sourceCode: string,
  filePath: string,
  fromId: string,
  toId: string
): { readonly changed: boolean; readonly nextSource: string } => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return { changed: false, nextSource: sourceCode };
  }

  const edits = findStringLiterals(ast, (value) => value === fromId).map(
    (match) => ({
      end: match.end,
      replacement: replaceQuotedLiteral(
        sourceCode,
        match.start,
        match.end,
        toId
      ),
      start: match.start,
    })
  );

  if (edits.length === 0) {
    return { changed: false, nextSource: sourceCode };
  }

  return {
    changed: true,
    nextSource: applyEdits(sourceCode, edits),
  };
};

const hasDraftIds = (sourceCode: string, filePath: string): boolean => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return sourceCode.includes(DRAFT_FILE_PREFIX);
  }
  return findStringLiterals(ast, (value) => isDraftId(value)).length > 0;
};

const toJsPath = (filePath: string): string => filePath.replace(/\.ts$/, '.js');

const toRelativeModulePath = (fromFile: string, toFile: string): string => {
  const rel = relative(dirname(fromFile), toJsPath(toFile)).replaceAll(
    '\\',
    '/'
  );
  return rel.startsWith('.') ? rel : `./${rel}`;
};

const replaceLiteralValue = (
  sourceCode: string,
  filePath: string,
  currentValue: string,
  nextValue: string
): { readonly changed: boolean; readonly nextSource: string } => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return { changed: false, nextSource: sourceCode };
  }

  const edits = findStringLiterals(ast, (value) => value === currentValue).map(
    (match) => ({
      end: match.end,
      replacement: replaceQuotedLiteral(
        sourceCode,
        match.start,
        match.end,
        nextValue
      ),
      start: match.start,
    })
  );

  if (edits.length === 0) {
    return { changed: false, nextSource: sourceCode };
  }

  return {
    changed: true,
    nextSource: applyEdits(sourceCode, edits),
  };
};

const collectOutputId = (app: Topo, id: string) =>
  app.get(id) ?? app.signals.get(id) ?? app.getResource(id);

const toRelativeOutputPath = (rootDir: string, filePath: string): string =>
  relative(rootDir, filePath).replaceAll('\\', '/');

const toProjectModulePath = (sourceImport: string): string =>
  sourceImport.startsWith('./')
    ? `./src/${sourceImport.slice(2)}`
    : sourceImport;

interface PromotionRewriteState {
  readonly plannedOperations: PlannedProjectOperation[];
  readonly renames: FileRename[];
  readonly updatedSourceFiles: Set<string>;
}

interface PromotionLoadState {
  readonly appModule: string | null;
  readonly loadError: string | null;
}

const validatePromotionInput = (input: {
  readonly fromId: string;
  readonly toId: string;
}): Result<void, ValidationError> => {
  if (!isDraftId(input.fromId)) {
    return Result.err(
      new ValidationError(
        `fromId must use the reserved draft prefix: "${input.fromId}"`
      )
    );
  }

  if (isDraftId(input.toId)) {
    return Result.err(
      new ValidationError(
        `toId must be established, not draft: "${input.toId}"`
      )
    );
  }

  return Result.ok();
};

const validatePromotionRoot = (
  rootDir: string
): Result<void, ValidationError> => {
  if (!existsSync(rootDir)) {
    return Result.err(
      new ValidationError(`rootDir does not exist: "${rootDir}"`)
    );
  }

  if (!statSync(rootDir).isDirectory()) {
    return Result.err(
      new ValidationError(`rootDir must be a directory: "${rootDir}"`)
    );
  }

  return Result.ok();
};

const resolveValidatedPromotionRoot = (
  input: {
    readonly fromId: string;
    readonly rootDir?: string | undefined;
    readonly toId: string;
  },
  ctx: { readonly cwd?: string | undefined }
): Result<string, ValidationError> => {
  const validation = validatePromotionInput(input);
  if (validation.isErr()) {
    return validation;
  }

  const cwd = resolve(ctx.cwd ?? process.cwd());
  const rootDir =
    input.rootDir === undefined ? cwd : resolve(cwd, input.rootDir);
  const rootValidation = validatePromotionRoot(rootDir);
  if (rootValidation.isErr()) {
    return rootValidation;
  }

  return Result.ok(rootDir);
};

type SourceFileMap = Map<string, string>;
type WriteProjectOperation = Extract<
  ProjectWriteOperation,
  { readonly kind: 'write' }
>;

const pushWriteOperation = (
  operations: ProjectWriteOperation[],
  operation: WriteProjectOperation
): void => {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const existing = operations[index];
    if (
      existing?.kind === 'rename' &&
      (existing.from === operation.path || existing.to === operation.path)
    ) {
      break;
    }
    if (existing?.kind === 'write' && existing.path === operation.path) {
      operations[index] = operation;
      return;
    }
  }

  operations.push(operation);
};

const readSourceFiles = async (
  filePaths: readonly string[]
): Promise<Result<SourceFileMap, Error>> => {
  const sources = new Map<string, string>();
  for (const filePath of filePaths) {
    try {
      sources.set(filePath, await Bun.file(filePath).text());
    } catch (error) {
      return Result.err(
        new ValidationError(
          `Cannot read source file "${filePath}"`,
          error instanceof Error ? { cause: error } : undefined
        )
      );
    }
  }
  return Result.ok(sources);
};

const planPromotedSourceFiles = (
  filePaths: readonly string[],
  sources: SourceFileMap,
  fromId: string,
  toId: string,
  updatedSourceFiles: Set<string>,
  operations: ProjectWriteOperation[]
): Result<void, Error> => {
  for (const filePath of filePaths) {
    const sourceCode = sources.get(filePath);
    if (sourceCode === undefined) {
      return Result.err(
        new ValidationError(`Cannot read source file "${filePath}"`)
      );
    }

    const replaced = replaceIdLiterals(sourceCode, filePath, fromId, toId);
    if (!replaced.changed) {
      continue;
    }

    sources.set(filePath, replaced.nextSource);
    pushWriteOperation(operations, {
      content: replaced.nextSource,
      kind: 'write',
      path: filePath,
    });
    updatedSourceFiles.add(filePath);
  }

  return Result.ok();
};

const buildPromotableFileRename = (
  filePath: string,
  fileName: string
): Result<FileRename | null, Error> => {
  const nextFileName = stripDraftFileMarkers(fileName);
  if (nextFileName === fileName) {
    return Result.ok(null);
  }

  const nextPath = join(dirname(filePath), nextFileName);
  if (nextPath !== filePath && existsSync(nextPath)) {
    return Result.err(
      new ValidationError(
        `Cannot promote draft file "${filePath}" because "${nextPath}" already exists.`
      )
    );
  }

  return Result.ok({ from: filePath, to: nextPath });
};

const collectPromotableFileRename = (
  filePath: string,
  sourceCode: string
): Result<FileRename | null, Error> => {
  if (!isDraftMarkedFile(filePath)) {
    return Result.ok(null);
  }

  const fileName = basename(filePath);
  if (!fileName) {
    return Result.ok(null);
  }

  if (hasDraftIds(sourceCode, filePath)) {
    return Result.ok(null);
  }

  return buildPromotableFileRename(filePath, fileName);
};

/** Validate that no two renames target the same path and no target already exists. */
const validateRenameTargets = (
  renames: readonly FileRename[]
): Result<void, Error> => {
  const targets = new Set<string>();
  for (const r of renames) {
    if (targets.has(r.to)) {
      return Result.err(
        new ValidationError(
          `Duplicate rename target "${r.to}" — multiple draft files would be renamed to the same path`
        )
      );
    }
    if (existsSync(r.to)) {
      return Result.err(
        new ValidationError(
          `Rename target "${r.to}" already exists — cannot overwrite`
        )
      );
    }
    targets.add(r.to);
  }
  return Result.ok();
};

const collectFileRenames = (
  filePaths: readonly string[],
  sources: SourceFileMap
): Result<FileRename[], Error> => {
  const renames: FileRename[] = [];
  for (const filePath of filePaths) {
    const sourceCode = sources.get(filePath);
    if (sourceCode === undefined) {
      return Result.err(
        new ValidationError(`Cannot read source file "${filePath}"`)
      );
    }
    const renameResult = collectPromotableFileRename(filePath, sourceCode);
    if (renameResult.isErr()) {
      return renameResult;
    }
    if (renameResult.value !== null) {
      renames.push(renameResult.value);
    }
  }
  return Result.ok(renames);
};

const applyRenameEffects = (
  updatedSourceFiles: Set<string>,
  renames: readonly FileRename[]
): void => {
  for (const rename of renames) {
    if (updatedSourceFiles.delete(rename.from)) {
      updatedSourceFiles.add(rename.to);
    }
  }
};

const applySourceRenameEffects = (
  sources: SourceFileMap,
  renames: readonly FileRename[]
): void => {
  for (const rename of renames) {
    const sourceCode = sources.get(rename.from);
    if (sourceCode === undefined) {
      continue;
    }
    sources.delete(rename.from);
    sources.set(rename.to, sourceCode);
  }
};

const applyFilePathRenames = (
  filePaths: readonly string[],
  renames: readonly FileRename[]
): string[] => {
  const renamedBySource = new Map(
    renames.map((rename) => [rename.from, rename.to])
  );
  return filePaths.map((filePath) => renamedBySource.get(filePath) ?? filePath);
};

const applyRelativeImportRename = (
  sourceCode: string,
  filePath: string,
  rename: FileRename
): { readonly changed: boolean; readonly sourceCode: string } => {
  const currentValue = toRelativeModulePath(filePath, rename.from);
  const nextValue = toRelativeModulePath(filePath, rename.to);
  if (currentValue === nextValue) {
    return { changed: false, sourceCode };
  }

  const replaced = replaceLiteralValue(
    sourceCode,
    filePath,
    currentValue,
    nextValue
  );
  if (!replaced.changed) {
    return { changed: false, sourceCode };
  }

  return { changed: true, sourceCode: replaced.nextSource };
};

const rewriteRelativeImportsForFile = (
  filePath: string,
  renames: readonly FileRename[],
  sourceCode: string
): { readonly changed: boolean; readonly sourceCode: string } => {
  let nextSourceCode = sourceCode;
  let changed = false;

  for (const rename of renames) {
    const updated = applyRelativeImportRename(nextSourceCode, filePath, rename);
    if (!updated.changed) {
      continue;
    }

    nextSourceCode = updated.sourceCode;
    changed = true;
  }

  return { changed, sourceCode: nextSourceCode };
};

const planRelativeImportsForFile = (
  filePath: string,
  renames: readonly FileRename[],
  sources: SourceFileMap,
  operations: ProjectWriteOperation[]
): Result<boolean, Error> => {
  const sourceCode = sources.get(filePath);
  if (sourceCode === undefined) {
    return Result.err(
      new ValidationError(`Cannot read source file "${filePath}"`)
    );
  }

  const updated = rewriteRelativeImportsForFile(filePath, renames, sourceCode);
  if (updated.changed) {
    sources.set(filePath, updated.sourceCode);
    pushWriteOperation(operations, {
      content: updated.sourceCode,
      kind: 'write',
      path: filePath,
    });
    return Result.ok(true);
  }

  return Result.ok(false);
};

const planRelativeImports = (
  filePaths: readonly string[],
  renames: readonly FileRename[],
  sources: SourceFileMap,
  updatedSourceFiles: Set<string>,
  operations: ProjectWriteOperation[]
): Result<void, Error> => {
  for (const filePath of filePaths) {
    const changed = planRelativeImportsForFile(
      filePath,
      renames,
      sources,
      operations
    );
    if (changed.isErr()) {
      return Result.err(changed.error);
    }
    if (changed.value) {
      updatedSourceFiles.add(filePath);
    }
  }

  return Result.ok();
};

const rewritePromotionState = async (
  rootDir: string,
  input: {
    readonly dryRun?: boolean | undefined;
    readonly fromId: string;
    readonly renameFiles: boolean;
    readonly toId: string;
  }
): Promise<Result<PromotionRewriteState, Error>> => {
  const initialFiles = collectTsFiles(rootDir);
  const sourcesResult = await readSourceFiles(initialFiles);
  if (sourcesResult.isErr()) {
    return Result.err(sourcesResult.error);
  }
  const sources = sourcesResult.value;
  const operations: ProjectWriteOperation[] = [];
  const updatedSourceFiles = new Set<string>();

  const rewritten = planPromotedSourceFiles(
    initialFiles,
    sources,
    input.fromId,
    input.toId,
    updatedSourceFiles,
    operations
  );
  if (rewritten.isErr()) {
    return Result.err(rewritten.error);
  }

  const renamesResult = input.renameFiles
    ? collectFileRenames(initialFiles, sources)
    : Result.ok([] as FileRename[]);
  if (renamesResult.isErr()) {
    return Result.err(renamesResult.error);
  }

  const valid = validateRenameTargets(renamesResult.value);
  if (valid.isErr()) {
    return valid;
  }

  for (const rename of renamesResult.value) {
    operations.push({ from: rename.from, kind: 'rename', to: rename.to });
  }

  applyRenameEffects(updatedSourceFiles, renamesResult.value);
  applySourceRenameEffects(sources, renamesResult.value);
  const importUpdates = planRelativeImports(
    applyFilePathRenames(initialFiles, renamesResult.value),
    renamesResult.value,
    sources,
    updatedSourceFiles,
    operations
  );
  if (importUpdates.isErr()) {
    return Result.err(importUpdates.error);
  }

  const plannedOperations = input.dryRun
    ? planProjectOperations(rootDir, operations)
    : await applyProjectOperations(rootDir, operations);
  if (plannedOperations.isErr()) {
    return Result.err(plannedOperations.error);
  }
  return Result.ok({
    plannedOperations: plannedOperations.value,
    renames: renamesResult.value,
    updatedSourceFiles,
  });
};

const resolvePromotionAppModule = async (
  input: {
    readonly appModule?: string | undefined;
  },
  rootDir: string
): Promise<string | null> => {
  const discoveredAppModule = await findTopoPath(rootDir);
  return (
    input.appModule ??
    (discoveredAppModule === null
      ? null
      : toProjectModulePath(discoveredAppModule))
  );
};

/**
 * Run `consume` while holding a fresh-load lease on `appModule`.
 *
 * @remarks
 * The lease deletes its on-disk mirror on release. Any Topo consumption that
 * may trigger deferred filesystem imports (for example inside a trail's
 * `blaze` or a lazy relative `import()`) must run before the lease is
 * released, otherwise those resolutions race the mirror teardown. Collapsing
 * consumption into the leased critical section keeps that contract
 * structural rather than relying on the caller to discover it.
 */
type LeaseAttempt =
  | {
      readonly ok: true;
      readonly lease: Awaited<ReturnType<typeof loadFreshAppLease>>;
    }
  | { readonly ok: false; readonly loadError: string };

const tryAcquireLease = async (
  appModule: string,
  rootDir: string
): Promise<LeaseAttempt> => {
  try {
    return { lease: await loadFreshAppLease(appModule, rootDir), ok: true };
  } catch (error) {
    const loadError = error instanceof Error ? error.message : String(error);
    return { loadError, ok: false };
  }
};

const withVerifiedApp = async <T>(
  appModule: string | null,
  rootDir: string,
  consume: (app: Topo) => T | Promise<T>
): Promise<{ readonly load: PromotionLoadState; readonly value: T | null }> => {
  if (appModule === null) {
    return { load: { appModule, loadError: null }, value: null };
  }

  const attempt = await tryAcquireLease(appModule, rootDir);
  if (!attempt.ok) {
    return { load: { appModule, loadError: attempt.loadError }, value: null };
  }

  try {
    const value = await consume(attempt.lease.app);
    return { load: { appModule, loadError: null }, value };
  } finally {
    attempt.lease.release();
  }
};

const toRenamedFiles = (rootDir: string, renames: readonly FileRename[]) =>
  renames.map((rename) => ({
    from: toRelativeOutputPath(rootDir, rename.from),
    to: toRelativeOutputPath(rootDir, rename.to),
  }));

const toUpdatedFiles = (rootDir: string, updatedSourceFiles: Set<string>) =>
  [...updatedSourceFiles]
    .toSorted()
    .map((filePath) => toRelativeOutputPath(rootDir, filePath));

const buildUnverifiedPromotionMessage = (
  loadError: string | null,
  dryRun: boolean
): string => {
  if (dryRun) {
    return 'Promotion plan is valid. Re-run without dryRun to apply it.';
  }

  return loadError === null
    ? 'Promotion rewrote source files, but no topo entrypoint could be loaded for verification.'
    : `Promotion rewrote source files, but verification failed: ${loadError}`;
};

const buildUnverifiedPromotionResult = (
  rootDir: string,
  loadError: string | null,
  renames: readonly FileRename[],
  updatedSourceFiles: Set<string>,
  appModule: string | null,
  plannedOperations: readonly PlannedProjectOperation[],
  dryRun: boolean
) =>
  Result.ok({
    appModule,
    dryRun,
    message: buildUnverifiedPromotionMessage(loadError, dryRun),
    plannedOperations,
    promotedEstablished: false,
    remainingDraftIds: [],
    renamedFiles: toRenamedFiles(rootDir, renames),
    updatedFiles: toUpdatedFiles(rootDir, updatedSourceFiles),
  });

const buildVerifiedPromotionResult = (
  rootDir: string,
  analysis: ReturnType<typeof deriveDraftReport>,
  promotedEstablished: boolean,
  renames: readonly FileRename[],
  updatedSourceFiles: Set<string>,
  appModule: string | null,
  plannedOperations: readonly PlannedProjectOperation[],
  toId: string
) => {
  const blockingFinding = analysis.findings.find(
    (finding) => finding.id === toId
  );

  return Result.ok({
    appModule,
    dryRun: false,
    message:
      blockingFinding?.message ??
      (promotedEstablished
        ? `Promoted "${toId}" is now established.`
        : `Promoted "${toId}" could not be verified as established.`),
    plannedOperations,
    promotedEstablished,
    remainingDraftIds: [...analysis.declaredDraftIds].toSorted(),
    renamedFiles: toRenamedFiles(rootDir, renames),
    updatedFiles: toUpdatedFiles(rootDir, updatedSourceFiles),
  });
};

const buildVerifiedPromotionResultFromApp = (
  rootDir: string,
  loadedApp: Topo,
  renames: readonly FileRename[],
  updatedSourceFiles: Set<string>,
  appModule: string | null,
  plannedOperations: readonly PlannedProjectOperation[],
  toId: string
) => {
  const analysis = deriveDraftReport(loadedApp);
  const promotedNode = collectOutputId(loadedApp, toId);
  const promotedEstablished =
    promotedNode !== undefined && !analysis.contaminatedIds.has(toId);

  return buildVerifiedPromotionResult(
    rootDir,
    analysis,
    promotedEstablished,
    renames,
    updatedSourceFiles,
    appModule,
    plannedOperations,
    toId
  );
};

const promoteDraftState = async (
  input: {
    readonly appModule?: string | undefined;
    readonly dryRun?: boolean | undefined;
    readonly fromId: string;
    readonly renameFiles: boolean;
    readonly rootDir?: string | undefined;
    readonly toId: string;
  },
  ctx: { readonly cwd?: string | undefined }
) => {
  const rootDirResult = resolveValidatedPromotionRoot(input, ctx);
  if (rootDirResult.isErr()) {
    return rootDirResult;
  }

  const rewriteResult = await rewritePromotionState(rootDirResult.value, input);
  if (rewriteResult.isErr()) {
    return Result.err(rewriteResult.error);
  }

  const { renames, updatedSourceFiles } = rewriteResult.value;
  const appModule = await resolvePromotionAppModule(input, rootDirResult.value);
  if (input.dryRun === true) {
    return buildUnverifiedPromotionResult(
      rootDirResult.value,
      null,
      renames,
      updatedSourceFiles,
      appModule,
      rewriteResult.value.plannedOperations,
      true
    );
  }

  const { load, value } = await withVerifiedApp(
    appModule,
    rootDirResult.value,
    (loadedApp) =>
      buildVerifiedPromotionResultFromApp(
        rootDirResult.value,
        loadedApp,
        renames,
        updatedSourceFiles,
        appModule,
        rewriteResult.value.plannedOperations,
        input.toId
      )
  );

  return (
    value ??
    buildUnverifiedPromotionResult(
      rootDirResult.value,
      load.loadError,
      renames,
      updatedSourceFiles,
      appModule,
      rewriteResult.value.plannedOperations,
      false
    )
  );
};

export const draftPromoteTrail = trail('draft.promote', {
  blaze: promoteDraftState,
  description:
    'Promote a draft id to an established id, rewrite inbound references, and verify the result against a fresh topo load.',
  examples: [
    {
      error: 'ValidationError',
      input: {
        // warden-ignore-next-line
        fromId: '_draft.entity.prepare',
        renameFiles: true,
        rootDir: './__does_not_exist__/draft-promote-example',
        toId: 'entity.prepare',
      },
      name: 'Rejects a missing project root before any rewrite begins',
    },
  ],
  input: z.object({
    appModule: z
      .string()
      .optional()
      .describe('Optional app module to verify after promotion'),
    dryRun: z
      .boolean()
      .default(false)
      .describe('Plan promotion rewrites without touching source files'),
    fromId: z.string().describe('Draft id to promote'),
    renameFiles: z
      .boolean()
      .default(true)
      .describe('Rename draft-marked files that no longer contain draft ids'),
    rootDir: z.string().optional().describe('Project root directory'),
    toId: z
      .string()
      .describe('Established id to write in place of the draft id'),
  }),
  intent: 'write',
  output: z.object({
    appModule: z.string().nullable(),
    dryRun: z.boolean(),
    message: z.string(),
    plannedOperations: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('mkdir'), path: z.string() }),
        z.object({
          from: z.string(),
          kind: z.literal('rename'),
          to: z.string(),
        }),
        z.object({ kind: z.literal('write'), path: z.string() }),
      ])
    ),
    promotedEstablished: z.boolean(),
    remainingDraftIds: z.array(z.string()),
    renamedFiles: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
      })
    ),
    updatedFiles: z.array(z.string()),
  }),
});
