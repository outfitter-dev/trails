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
  findStringLiterals,
  isDraftMarkedFile,
  parse,
  stripDraftFileMarkers,
} from '@ontrails/warden';
import { z } from 'zod';

import { renameProjectPath, writeProjectPath } from '../project-writes.js';
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

const rewritePromotedSourceFiles = async (
  rootDir: string,
  filePaths: readonly string[],
  fromId: string,
  toId: string,
  updatedSourceFiles: Set<string>
): Promise<Result<void, Error>> => {
  for (const filePath of filePaths) {
    const sourceCode = await Bun.file(filePath).text();
    const replaced = replaceIdLiterals(sourceCode, filePath, fromId, toId);
    if (!replaced.changed) {
      continue;
    }

    const written = await writeProjectPath(
      rootDir,
      filePath,
      replaced.nextSource
    );
    if (written.isErr()) {
      return Result.err(written.error);
    }
    updatedSourceFiles.add(filePath);
  }

  return Result.ok();
};

const hasDraftIdsInFile = async (filePath: string): Promise<boolean> => {
  const sourceCode = await Bun.file(filePath).text();
  return hasDraftIds(sourceCode, filePath);
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

const collectPromotableFileRename = async (
  filePath: string
): Promise<Result<FileRename | null, Error>> => {
  if (!isDraftMarkedFile(filePath)) {
    return Result.ok(null);
  }

  const fileName = basename(filePath);
  if (!fileName) {
    return Result.ok(null);
  }

  if (await hasDraftIdsInFile(filePath)) {
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

const collectFileRenames = async (
  filePaths: readonly string[]
): Promise<Result<FileRename[], Error>> => {
  const renames: FileRename[] = [];
  for (const filePath of filePaths) {
    const renameResult = await collectPromotableFileRename(filePath);
    if (renameResult.isErr()) {
      return renameResult;
    }
    if (renameResult.value !== null) {
      renames.push(renameResult.value);
    }
  }
  return Result.ok(renames);
};

const collectAndApplyFileRenames = async (
  rootDir: string,
  filePaths: readonly string[]
): Promise<Result<FileRename[], Error>> => {
  const collected = await collectFileRenames(filePaths);
  if (collected.isErr()) {
    return collected;
  }

  const renames = collected.value;
  const valid = validateRenameTargets(renames);
  if (valid.isErr()) {
    return valid;
  }

  for (const r of renames) {
    const renamed = renameProjectPath(rootDir, r.from, r.to);
    if (renamed.isErr()) {
      return Result.err(renamed.error);
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

const updateRelativeImportsForFile = async (
  rootDir: string,
  filePath: string,
  renames: readonly FileRename[]
): Promise<Result<boolean, Error>> => {
  const sourceCode = await Bun.file(filePath).text();
  const updated = rewriteRelativeImportsForFile(filePath, renames, sourceCode);
  if (updated.changed) {
    const written = await writeProjectPath(
      rootDir,
      filePath,
      updated.sourceCode
    );
    if (written.isErr()) {
      return Result.err(written.error);
    }
    return Result.ok(true);
  }

  return Result.ok(false);
};

const updateRelativeImports = async (
  rootDir: string,
  filePaths: readonly string[],
  renames: readonly FileRename[]
): Promise<Result<string[], Error>> => {
  const updatedFiles = new Set<string>();

  for (const filePath of filePaths) {
    const changed = await updateRelativeImportsForFile(
      rootDir,
      filePath,
      renames
    );
    if (changed.isErr()) {
      return Result.err(changed.error);
    }
    if (changed.value) {
      updatedFiles.add(filePath);
    }
  }

  return Result.ok([...updatedFiles].toSorted());
};

const rewritePromotionState = async (
  rootDir: string,
  input: {
    readonly fromId: string;
    readonly renameFiles: boolean;
    readonly toId: string;
  }
): Promise<Result<PromotionRewriteState, Error>> => {
  const initialFiles = collectTsFiles(rootDir);
  const updatedSourceFiles = new Set<string>();

  const rewritten = await rewritePromotedSourceFiles(
    rootDir,
    initialFiles,
    input.fromId,
    input.toId,
    updatedSourceFiles
  );
  if (rewritten.isErr()) {
    return Result.err(rewritten.error);
  }

  const renamesResult = input.renameFiles
    ? await collectAndApplyFileRenames(rootDir, initialFiles)
    : Result.ok([] as FileRename[]);
  if (renamesResult.isErr()) {
    return Result.err(renamesResult.error);
  }

  applyRenameEffects(updatedSourceFiles, renamesResult.value);
  const importUpdates = await updateRelativeImports(
    rootDir,
    collectTsFiles(rootDir),
    renamesResult.value
  );
  if (importUpdates.isErr()) {
    return Result.err(importUpdates.error);
  }

  for (const f of importUpdates.value) {
    updatedSourceFiles.add(f);
  }
  return Result.ok({ renames: renamesResult.value, updatedSourceFiles });
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

const buildUnverifiedPromotionResult = (
  rootDir: string,
  loadError: string | null,
  renames: readonly FileRename[],
  updatedSourceFiles: Set<string>,
  appModule: string | null
) =>
  Result.ok({
    appModule,
    message:
      loadError === null
        ? 'Promotion rewrote source files, but no topo entrypoint could be loaded for verification.'
        : `Promotion rewrote source files, but verification failed: ${loadError}`,
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
  toId: string
) => {
  const blockingFinding = analysis.findings.find(
    (finding) => finding.id === toId
  );

  return Result.ok({
    appModule,
    message:
      blockingFinding?.message ??
      (promotedEstablished
        ? `Promoted "${toId}" is now established.`
        : `Promoted "${toId}" could not be verified as established.`),
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
    toId
  );
};

const promoteDraftState = async (
  input: {
    readonly appModule?: string | undefined;
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
      appModule
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
    message: z.string(),
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
