import {
  InternalError,
  Result,
  ValidationError,
  deriveSafePath,
  escapeRegExp,
  matchesAnyPathGlob,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, posix } from 'node:path';

import { createAstStringLiteralRenameClass } from './ast-rewrite.js';
import {
  DEFAULT_IGNORED_DIRECTORIES,
  collectDownstreamSources,
} from './collect.js';
import type {
  RegradeClassResult,
  RegradeReport,
  RegradeReportEntry,
} from './report.js';
import { buildRegradeScanSummary } from './scan-summary.js';
import type { DownstreamSourceCollection } from './collect.js';
import {
  deriveVocabularyFormProposals,
  vocabularyRewriteFormsForPlan,
} from './vocabulary.js';
import type {
  VocabularyFileRename,
  VocabularyFileRenameEvidence,
  VocabularyRegradePlan,
  VocabularyRegradeScope,
} from './vocabulary.js';

/**
 * A review-only file move proposed from a minimal vocabulary seed.
 *
 * @example
 * ```ts
 * const candidate: FileRenameCandidate = {
 *   evidence: ['docs/surface-facets.md'],
 *   from: 'docs/surface-facets.md',
 *   to: 'docs/surface-trailheads.md',
 * };
 * ```
 */
export interface FileRenameCandidate extends VocabularyFileRename {
  readonly evidence: readonly string[];
}

const fileRenameSourceExtensions = Object.freeze([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.json',
  '.jsonc',
  '.md',
  '.mdx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const astSourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

const emittedModuleExtensions = new Map([
  ['.cts', '.cjs'],
  ['.mts', '.mjs'],
  ['.ts', '.js'],
  ['.tsx', '.js'],
]);

interface ReferenceMapping {
  readonly from: string;
  readonly moduleSpecifierOnly?: boolean;
  readonly renameIndex: number;
  readonly to: string;
}

interface AmbiguousReferenceMapping {
  readonly from: string;
  readonly renameIndexes: readonly number[];
}

interface MutableEvidence {
  deferred: number;
  historical: number;
  preserved: number;
  rewritten: number;
  skipped: number;
}

const emptyEvidence = (): MutableEvidence => ({
  deferred: 0,
  historical: 0,
  preserved: 0,
  rewritten: 0,
  skipped: 0,
});

const updateEvidence = (
  evidence: readonly MutableEvidence[],
  index: number,
  update: (item: MutableEvidence) => void
): void => {
  const item = evidence[index];
  if (item !== undefined) {
    update(item);
  }
};

/**
 * Report and per-move evidence produced by a governed file rename pass.
 *
 * @example
 * ```ts
 * const run: FileRenameRegradeRun = result.value;
 * console.log(run.evidence[0]?.rewritten);
 * ```
 */
export interface FileRenameRegradeRun {
  readonly changedPaths: readonly string[];
  readonly evidence: readonly VocabularyFileRenameEvidence[];
  readonly occurrencePaths: readonly string[];
  readonly policyOccurrencePaths: readonly string[];
  readonly report: RegradeReport;
}

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const normalizeRenamePath = (path: string): string =>
  posix.normalize(path.replaceAll('\\', '/'));

const openedPolicyDirectories = (
  scope: VocabularyRegradeScope | undefined
): readonly string[] =>
  DEFAULT_IGNORED_DIRECTORIES.filter((directory) =>
    scope?.policyClassified?.some((policy) =>
      policy.paths.some((pattern) => pattern.split('/').includes(directory))
    )
  );

const policyForPath = (
  path: string,
  scope: VocabularyRegradeScope | undefined
) =>
  scope?.policyClassified?.find((policy) =>
    matchesAnyPathGlob(path, policy.paths)
  );

const importerRenameForPath = (params: {
  readonly path: string;
  readonly renames: readonly VocabularyFileRename[];
  readonly resolved: readonly ResolvedFileRename[];
  readonly useTargetPaths: boolean;
}): VocabularyFileRename | undefined => {
  const path = normalizeRenamePath(params.path);
  const incomingIndex = params.renames.findIndex(
    (rename) => normalizeRenamePath(rename.to) === path
  );
  const outgoingIndex = params.renames.findIndex(
    (rename) => normalizeRenamePath(rename.from) === path
  );
  if (params.useTargetPaths) {
    return params.renames[incomingIndex];
  }
  if (
    incomingIndex !== -1 &&
    params.resolved[incomingIndex]?.alreadyApplied === true
  ) {
    return params.renames[incomingIndex];
  }
  if (
    outgoingIndex !== -1 &&
    params.resolved[outgoingIndex]?.alreadyApplied !== true
  ) {
    return params.renames[outgoingIndex];
  }
  return params.renames[incomingIndex === -1 ? outgoingIndex : incomingIndex];
};

const sourcePathForMovedTarget = (
  path: string,
  renames: readonly VocabularyFileRename[]
): string =>
  normalizeRenamePath(
    renames.find(
      (rename) => normalizeRenamePath(rename.to) === normalizeRenamePath(path)
    )?.from ?? path
  );

const relativeReferenceTarget = (path: string): string =>
  path.startsWith('.') ? path : `./${path}`;

const hasAstSourceExtensions = (from: string, to: string): boolean =>
  astSourceExtensions.has(extname(from)) &&
  astSourceExtensions.has(extname(to));

const preserveVocabularyCase = (
  sourceForm: string,
  replacement: string
): string => {
  if (sourceForm.toUpperCase() === sourceForm) {
    return replacement.toUpperCase();
  }
  const first = sourceForm.at(0);
  return first !== undefined && first.toUpperCase() === first
    ? replacement.at(0)?.toUpperCase() + replacement.slice(1)
    : replacement;
};

const projectVocabularyText = (
  source: string,
  plan: VocabularyRegradePlan
): string => {
  let projected = source;
  const safeForms = vocabularyRewriteFormsForPlan(plan).toSorted(
    ([left], [right]) => right.length - left.length
  );
  for (const [from, to] of safeForms) {
    projected = projected.replaceAll(
      new RegExp(
        `(?<![A-Za-z0-9_$-])${escapeRegExp(from)}(?![A-Za-z0-9_$-])`,
        plan.caseSensitive === true ? 'gu' : 'giu'
      ),
      (matched) =>
        plan.caseSensitive === true ? to : preserveVocabularyCase(matched, to)
    );
  }
  return projected;
};

const astReferenceMappings = (
  relativeFrom: string,
  relativeTo: string,
  renameIndex: number
): readonly ReferenceMapping[] => {
  if (!hasAstSourceExtensions(relativeFrom, relativeTo)) {
    return [];
  }
  const fromExtension = extname(relativeFrom);
  const toExtension = extname(relativeTo);
  const extensionlessFrom = relativeFrom.slice(0, -fromExtension.length);
  const extensionlessTo = relativeTo.slice(0, -toExtension.length);
  const mappings: ReferenceMapping[] = [
    {
      from: relativeReferenceTarget(extensionlessFrom),
      moduleSpecifierOnly: true,
      renameIndex,
      to: relativeReferenceTarget(extensionlessTo),
    },
  ];
  if (posix.basename(extensionlessFrom) === 'index') {
    const indexTarget =
      posix.basename(extensionlessTo) === 'index'
        ? posix.dirname(extensionlessTo)
        : extensionlessTo;
    mappings.push({
      from: relativeReferenceTarget(posix.dirname(extensionlessFrom)),
      moduleSpecifierOnly: true,
      renameIndex,
      to: relativeReferenceTarget(indexTarget),
    });
  }
  const emittedFromExtension = emittedModuleExtensions.get(fromExtension);
  const emittedToExtension = emittedModuleExtensions.get(toExtension);
  if (emittedFromExtension === undefined || emittedToExtension === undefined) {
    return mappings;
  }
  const emittedFrom = `${extensionlessFrom}${emittedFromExtension}`;
  const emittedTo = `${extensionlessTo}${emittedToExtension}`;
  mappings.push({
    from: relativeReferenceTarget(emittedFrom),
    moduleSpecifierOnly: true,
    renameIndex,
    to: relativeReferenceTarget(emittedTo),
  });
  return mappings;
};

const referenceMappingsForSourcePath = (params: {
  readonly finalDirectory: string;
  readonly rename: VocabularyFileRename;
  readonly renameIndex: number;
  readonly sourceDirectory: string;
  readonly sourcePath: string;
}): readonly ReferenceMapping[] => {
  if (
    normalizeRenamePath(params.sourcePath) ===
    normalizeRenamePath(params.rename.to)
  ) {
    return [];
  }
  const relativeFrom = posix.relative(
    params.sourceDirectory,
    params.sourcePath
  );
  const relativeTo = posix.relative(params.finalDirectory, params.rename.to);
  const mappings: ReferenceMapping[] = [
    {
      from: params.sourcePath,
      renameIndex: params.renameIndex,
      to: params.rename.to,
    },
    { from: relativeFrom, renameIndex: params.renameIndex, to: relativeTo },
    ...astReferenceMappings(relativeFrom, relativeTo, params.renameIndex),
  ];
  if (!relativeFrom.startsWith('.')) {
    mappings.push({
      from: `./${relativeFrom}`,
      renameIndex: params.renameIndex,
      to: relativeReferenceTarget(relativeTo),
    });
  }
  return mappings;
};

const referenceMappingsForPath = (
  path: string,
  renames: readonly VocabularyFileRename[],
  excludedRenameIndexes: ReadonlySet<number> = new Set(),
  resolved: readonly ResolvedFileRename[] = [],
  useTargetPaths = false,
  vocabularyPlan?: VocabularyRegradePlan
): {
  readonly ambiguous: readonly AmbiguousReferenceMapping[];
  readonly safe: readonly ReferenceMapping[];
} => {
  const importerRename = importerRenameForPath({
    path,
    renames,
    resolved,
    useTargetPaths,
  });
  const sourceImporterPath = normalizeRenamePath(importerRename?.from ?? path);
  const finalImporterPath = normalizeRenamePath(importerRename?.to ?? path);
  const sourceDirectory = posix.dirname(sourceImporterPath);
  const finalDirectory = posix.dirname(finalImporterPath);
  const mappings: ReferenceMapping[] = [];
  for (const [renameIndex, authoredRename] of renames.entries()) {
    if (excludedRenameIndexes.has(renameIndex)) {
      continue;
    }
    const rename = {
      from: normalizeRenamePath(authoredRename.from),
      to: normalizeRenamePath(authoredRename.to),
    };
    const sourcePaths = [
      rename.from,
      ...(vocabularyPlan === undefined
        ? []
        : [projectVocabularyText(rename.from, vocabularyPlan)]),
    ].filter((value, index, values) => values.indexOf(value) === index);
    for (const sourcePath of sourcePaths) {
      mappings.push(
        ...referenceMappingsForSourcePath({
          finalDirectory,
          rename,
          renameIndex,
          sourceDirectory,
          sourcePath,
        })
      );
    }
  }

  const targetsByForm = new Map<string, Set<string>>();
  for (const mapping of mappings) {
    const targets = targetsByForm.get(mapping.from) ?? new Set<string>();
    targets.add(mapping.to);
    targetsByForm.set(mapping.from, targets);
  }
  const ambiguous = [...targetsByForm.entries()]
    .filter(([from, targets]) => from.length > 0 && targets.size > 1)
    .map(([from]) => ({
      from,
      renameIndexes: [
        ...new Set(
          mappings
            .filter((mapping) => mapping.from === from)
            .map((mapping) => mapping.renameIndex)
        ),
      ],
    }));
  const indexesByBasename = new Map<string, number[]>();
  for (const [renameIndex, rename] of renames.entries()) {
    const basename = posix.basename(rename.from);
    const indexes = indexesByBasename.get(basename) ?? [];
    indexes.push(renameIndex);
    indexesByBasename.set(basename, indexes);
  }
  for (const [basename, renameIndexes] of indexesByBasename) {
    if (renameIndexes.length > 1 && !targetsByForm.has(basename)) {
      ambiguous.push({ from: basename, renameIndexes });
    }
  }
  const safe = mappings
    .filter(
      (mapping, index) =>
        mapping.from.length > 0 &&
        targetsByForm.get(mapping.from)?.size === 1 &&
        mappings.findIndex(
          (candidate) =>
            candidate.from === mapping.from &&
            candidate.renameIndex === mapping.renameIndex
        ) === index
    )
    .toSorted((left, right) => right.from.length - left.from.length);
  return { ambiguous, safe };
};

const countText = (source: string, text: string): number => {
  if (text.length === 0) {
    return 0;
  }
  let count = 0;
  let offset = 0;
  while (offset < source.length) {
    const index = source.indexOf(text, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + text.length;
  }
  return count;
};

const referencePattern = (text: string): RegExp =>
  new RegExp(
    `(?<![A-Za-z0-9_./-])${escapeRegExp(text)}(?![A-Za-z0-9_./-])`,
    'gu'
  );

const countReference = (source: string, text: string): number =>
  [...source.matchAll(referencePattern(text))].length;

const containsExactStringLiteral = (source: string, value: string): boolean =>
  [`'${value}'`, `"${value}"`, `\`${value}\``].some((literal) =>
    source.includes(literal)
  );

const countExactStringLiterals = (source: string, value: string): number =>
  [`'${value}'`, `"${value}"`, `\`${value}\``].reduce(
    (count, literal) => count + countText(source, literal),
    0
  );

const reviewedStringLiteralCount = (params: {
  readonly mapping: ReferenceMapping;
  readonly result: RegradeClassResult;
  readonly source: string;
}): number => {
  if (params.result.kind !== 'needs-review') {
    return 0;
  }
  if (params.result.reviewDetails !== undefined) {
    return (
      params.result.reviewDetails.length +
      (params.mapping.moduleSpecifierOnly === true
        ? countExactStringLiterals(params.source, params.mapping.from)
        : 0)
    );
  }
  if (
    params.mapping.moduleSpecifierOnly !== true ||
    (params.result.reason?.startsWith('ast-rewrite-') === true &&
      !containsExactStringLiteral(params.source, params.mapping.from))
  ) {
    return 0;
  }
  return countExactStringLiterals(params.source, params.mapping.from);
};

const collisionFreePlaceholders = (
  source: string,
  mappings: readonly ReferenceMapping[],
  label: string
): readonly string[] => {
  let generation = 0;
  while (true) {
    const placeholders: string[] = [];
    for (const [index] of mappings.entries()) {
      placeholders.push(`__TRAILS_${label}_${generation}_${index}__`);
    }
    if (
      placeholders.every(
        (placeholder) =>
          !source.includes(placeholder) &&
          mappings.every(
            (mapping) =>
              !mapping.from.includes(placeholder) &&
              !mapping.to.includes(placeholder)
          )
      )
    ) {
      return placeholders;
    }
    generation += 1;
  }
};

const replaceSimultaneously = (
  source: string,
  mappings: readonly ReferenceMapping[],
  evidence: readonly MutableEvidence[]
): string => {
  let nextSource = source;
  const placeholders = collisionFreePlaceholders(
    source,
    mappings,
    'FILE_RENAME_REFERENCE'
  );
  for (const [index, mapping] of mappings.entries()) {
    const count = countReference(nextSource, mapping.from);
    if (count === 0) {
      continue;
    }
    nextSource = nextSource.replaceAll(
      referencePattern(mapping.from),
      placeholders[index] ?? ''
    );
    updateEvidence(evidence, mapping.renameIndex, (item) => {
      item.rewritten += count;
    });
  }
  for (const [index, mapping] of mappings.entries()) {
    nextSource = nextSource.replaceAll(placeholders[index] ?? '', mapping.to);
  }
  return nextSource;
};

const rewriteAstReferences = (
  source: string,
  path: string,
  mappings: readonly ReferenceMapping[],
  evidence: readonly MutableEvidence[]
): { readonly deferred: boolean; readonly source: string } => {
  let nextSource = source;
  const placeholders = collisionFreePlaceholders(
    source,
    mappings,
    'FILE_RENAME_LITERAL'
  );
  const reviewedModuleSpecifierRenames = new Map<number, number>();
  for (const [index, mapping] of mappings.entries()) {
    const cls = createAstStringLiteralRenameClass({
      allowModuleSpecifier: true,
      from: mapping.from,
      id: `file-reference:${mapping.from}->${mapping.to}`,
      match: 'exact',
      ...(mapping.moduleSpecifierOnly === true
        ? { moduleSpecifierOnly: true }
        : {}),
      to: placeholders[index] ?? '',
    });
    const result = cls.apply(nextSource, { path });
    if (result.kind === 'rewrite' && result.nextSource !== undefined) {
      const { nextSource: rewrittenSource } = result;
      const count = countText(rewrittenSource, placeholders[index] ?? '');
      updateEvidence(evidence, mapping.renameIndex, (item) => {
        item.rewritten += count;
      });
      nextSource = rewrittenSource;
    } else {
      const reviewed = reviewedStringLiteralCount({
        mapping,
        result,
        source: nextSource,
      });
      if (reviewed === 0) {
        continue;
      }
      reviewedModuleSpecifierRenames.set(
        mapping.renameIndex,
        (reviewedModuleSpecifierRenames.get(mapping.renameIndex) ?? 0) +
          reviewed
      );
    }
  }
  for (const [index, mapping] of mappings.entries()) {
    nextSource = nextSource.replaceAll(placeholders[index] ?? '', mapping.to);
  }

  let deferred = false;
  for (const mapping of mappings) {
    if (mapping.moduleSpecifierOnly === true) {
      continue;
    }
    const remaining = countReference(nextSource, mapping.from);
    if (remaining > 0) {
      updateEvidence(evidence, mapping.renameIndex, (item) => {
        item.deferred += remaining;
      });
      deferred = true;
    }
  }
  for (const [renameIndex, count] of reviewedModuleSpecifierRenames) {
    updateEvidence(evidence, renameIndex, (item) => {
      item.deferred += count;
    });
    deferred = true;
  }
  return { deferred, source: nextSource };
};

interface ResolvedFileRename {
  readonly alreadyApplied: boolean;
  readonly from: string;
  readonly to: string;
}

const orderRenamesForApply = <
  T extends { readonly from: string; readonly to: string },
>(
  renames: readonly T[]
): TrailsResult<readonly T[], Error> => {
  const successors = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const byFrom = new Map<string, T>();
  for (const rename of renames) {
    byFrom.set(rename.from, rename);
    successors.set(rename.from, []);
    indegree.set(rename.from, 0);
  }
  for (const rename of renames) {
    if (!byFrom.has(rename.to)) {
      continue;
    }
    // Vacate rename.to before writing into it.
    successors.get(rename.to)?.push(rename.from);
    indegree.set(rename.from, (indegree.get(rename.from) ?? 0) + 1);
  }
  const queue = renames
    .map((rename) => rename.from)
    .filter((from) => (indegree.get(from) ?? 0) === 0);
  const ordered: T[] = [];
  while (queue.length > 0) {
    const from = queue.shift();
    if (from === undefined) {
      break;
    }
    const rename = byFrom.get(from);
    if (rename !== undefined) {
      ordered.push(rename);
    }
    for (const dependent of successors.get(from) ?? []) {
      const nextDegree = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, nextDegree);
      if (nextDegree === 0) {
        queue.push(dependent);
      }
    }
  }
  if (ordered.length !== renames.length) {
    return Result.err(
      new ValidationError(
        'File rename map contains a cycle that cannot be applied safely.'
      )
    );
  }
  return Result.ok(ordered);
};

const isCompletedRenameChain = (
  root: string,
  rename: VocabularyFileRename,
  renames: readonly VocabularyFileRename[]
): boolean => {
  const byFrom = new Map(
    renames.map((candidate) => [normalizeRenamePath(candidate.from), candidate])
  );
  const byTo = new Map(
    renames.map((candidate) => [normalizeRenamePath(candidate.to), candidate])
  );
  const visited = new Set<string>();
  let first = rename;
  while (byTo.has(normalizeRenamePath(first.from))) {
    const from = normalizeRenamePath(first.from);
    if (visited.has(from)) {
      return false;
    }
    visited.add(from);
    const predecessor = byTo.get(from);
    if (predecessor === undefined) {
      break;
    }
    first = predecessor;
  }
  const firstSource = deriveSafePath(root, first.from);
  if (
    firstSource.isErr() ||
    (existsSync(firstSource.value) && statSync(firstSource.value).isFile())
  ) {
    return false;
  }
  visited.clear();
  let current: VocabularyFileRename | undefined = first;
  while (current !== undefined) {
    const from = normalizeRenamePath(current.from);
    if (visited.has(from)) {
      return false;
    }
    visited.add(from);
    const target = deriveSafePath(root, current.to);
    if (
      target.isErr() ||
      !existsSync(target.value) ||
      !statSync(target.value).isFile()
    ) {
      return false;
    }
    current = byFrom.get(normalizeRenamePath(current.to));
  }
  return true;
};

const validateRenames = (
  root: string,
  renames: readonly VocabularyFileRename[]
): TrailsResult<readonly ResolvedFileRename[], Error> => {
  const resolved: ResolvedFileRename[] = [];
  const sources = new Set<string>();
  const targets = new Set<string>();
  const safeRenames: {
    readonly from: string;
    readonly rename: VocabularyFileRename;
    readonly to: string;
  }[] = [];
  for (const rename of renames) {
    const from = deriveSafePath(root, rename.from);
    const to = deriveSafePath(root, rename.to);
    if (from.isErr() || to.isErr()) {
      return Result.err(
        new ValidationError(
          'File rename paths must stay within the Regrade root.'
        )
      );
    }
    safeRenames.push({ from: from.value, rename, to: to.value });
  }
  const sourcePaths = new Set(safeRenames.map((rename) => rename.from));
  for (const safeRename of safeRenames) {
    const { rename } = safeRename;
    if (safeRename.from === safeRename.to) {
      return Result.err(
        new ValidationError(
          `File rename source and target are identical: "${rename.from}".`
        )
      );
    }
    if (sources.has(safeRename.from) || targets.has(safeRename.to)) {
      return Result.err(
        new ValidationError('File rename sources and targets must be unique.')
      );
    }
    const sourceExists =
      existsSync(safeRename.from) && statSync(safeRename.from).isFile();
    const targetExists =
      existsSync(safeRename.to) && statSync(safeRename.to).isFile();
    const chainAlreadyApplied = isCompletedRenameChain(root, rename, renames);
    if (!sourceExists && !targetExists) {
      return Result.err(
        new ValidationError(
          `File rename source does not exist: "${rename.from}".`
        )
      );
    }
    // Intermediate targets may already exist when they are also a source in
    // this map; those paths are vacated before the dependent move applies.
    if (
      sourceExists &&
      targetExists &&
      !sourcePaths.has(safeRename.to) &&
      !chainAlreadyApplied
    ) {
      return Result.err(
        new ValidationError(
          `File rename target already exists: "${rename.to}".`
        )
      );
    }
    sources.add(safeRename.from);
    targets.add(safeRename.to);
    resolved.push({
      alreadyApplied: chainAlreadyApplied || (!sourceExists && targetExists),
      from: safeRename.from,
      to: safeRename.to,
    });
  }

  const ordered = orderRenamesForApply(safeRenames);
  return ordered.isErr() ? ordered : Result.ok(resolved);
};

const rollbackResolvedRenames = (
  renames: readonly ResolvedFileRename[]
): void => {
  for (const rename of renames.toReversed()) {
    if (!existsSync(rename.to) || existsSync(rename.from)) {
      continue;
    }
    mkdirSync(dirname(rename.from), { recursive: true });
    renameSync(rename.to, rename.from);
  }
};

const applyResolvedRenames = (
  renames: readonly ResolvedFileRename[]
): TrailsResult<readonly ResolvedFileRename[], Error> => {
  const pending = renames.filter((rename) => !rename.alreadyApplied);
  const ordered = orderRenamesForApply(pending);
  if (ordered.isErr()) {
    return ordered;
  }
  const applied: ResolvedFileRename[] = [];
  try {
    for (const rename of ordered.value) {
      mkdirSync(dirname(rename.to), { recursive: true });
      renameSync(rename.from, rename.to);
      applied.push(rename);
    }
    return Result.ok(applied);
  } catch (error) {
    rollbackResolvedRenames(applied);
    return Result.err(
      new InternalError('Failed to apply governed file moves.', {
        cause: asError(error),
      })
    );
  }
};

const fileMoveNote = (
  rename: VocabularyFileRename,
  alreadyApplied: boolean,
  apply: boolean
): string => {
  if (alreadyApplied) {
    return `File already resides at governed target "${rename.to}".`;
  }
  return apply
    ? `Moved "${rename.from}" to "${rename.to}" before rewriting references.`
    : `Would move "${rename.from}" to "${rename.to}" before rewriting references.`;
};

const initialFileMoveEntries = (
  renames: readonly VocabularyFileRename[],
  resolved: readonly ResolvedFileRename[],
  apply: boolean
): RegradeReportEntry[] =>
  renames.map((rename, index) => {
    const alreadyApplied = resolved[index]?.alreadyApplied === true;
    return {
      classId: `file-rename:${rename.from}->${rename.to}`,
      notes: [fileMoveNote(rename, alreadyApplied, apply)],
      outcome: alreadyApplied || apply ? 'no-op' : 'rewrite',
      path: alreadyApplied || apply ? rename.to : rename.from,
    };
  });

const recordPolicyReferences = (params: {
  readonly evidence: readonly MutableEvidence[];
  readonly mappings: ReturnType<typeof referenceMappingsForPath>;
  readonly occurrencePaths: string[];
  readonly path: string;
  readonly preserved: boolean;
  readonly source: string;
}): void => {
  for (const mapping of params.mappings.safe) {
    const count = countReference(params.source, mapping.from);
    updateEvidence(params.evidence, mapping.renameIndex, (item) => {
      item.historical += count;
      if (params.preserved) {
        item.preserved += count;
      } else {
        item.skipped += count;
      }
    });
    params.occurrencePaths.push(
      ...Array.from({ length: count }, () => params.path)
    );
  }
  for (const mapping of params.mappings.ambiguous) {
    const count = countReference(params.source, mapping.from);
    for (const renameIndex of mapping.renameIndexes) {
      updateEvidence(params.evidence, renameIndex, (item) => {
        item.historical += count;
        item.skipped += count;
      });
    }
    params.occurrencePaths.push(
      ...Array.from({ length: count }, () => params.path)
    );
  }
};

const recordAmbiguousReferences = (
  source: string,
  mappings: readonly AmbiguousReferenceMapping[],
  evidence: readonly MutableEvidence[]
): boolean => {
  let deferred = false;
  for (const mapping of mappings) {
    const count = countReference(source, mapping.from);
    if (count === 0) {
      continue;
    }
    deferred = true;
    for (const renameIndex of mapping.renameIndexes) {
      updateEvidence(evidence, renameIndex, (item) => {
        item.deferred += count;
      });
    }
  }
  return deferred;
};

const referenceEntry = (
  path: string,
  deferred: boolean
): RegradeReportEntry => ({
  classId: 'file-reference-closure',
  ...(deferred ? { reason: 'file-reference-context-unverified' } : {}),
  notes: [
    deferred
      ? 'A path-like occurrence was not an exact code string literal and requires review.'
      : 'Derived a safe reference rewrite from the final file rename map.',
  ],
  outcome: deferred ? 'needs-review' : 'rewrite',
  path,
});

interface PlannedReferenceWrite {
  readonly absolutePath: string;
  readonly nextSource: string;
  readonly source: string;
}

const applyReferenceWrites = (
  writes: readonly PlannedReferenceWrite[]
): TrailsResult<void, Error> => {
  const applied: PlannedReferenceWrite[] = [];
  try {
    for (const write of writes) {
      writeFileSync(write.absolutePath, write.nextSource, 'utf8');
      applied.push(write);
    }
    return Result.ok();
  } catch (error) {
    for (const write of applied.toReversed()) {
      try {
        writeFileSync(write.absolutePath, write.source, 'utf8');
      } catch {
        // Preserve the original apply failure; the caller still rolls back moves.
      }
    }
    return Result.err(
      new InternalError('Failed to apply governed file reference rewrites.', {
        cause: asError(error),
      })
    );
  }
};

const rewriteReferenceFiles = (params: {
  readonly apply: boolean;
  readonly collected: DownstreamSourceCollection;
  readonly evidence: readonly MutableEvidence[];
  readonly excludedRenameIndexes?: ReadonlySet<number>;
  readonly renames: readonly VocabularyFileRename[];
  readonly resolved: readonly ResolvedFileRename[];
  readonly scope?: VocabularyRegradeScope;
  readonly vocabularyPlan?: VocabularyRegradePlan;
}): TrailsResult<
  {
    readonly changedFiles: ReadonlySet<string>;
    readonly entries: readonly RegradeReportEntry[];
    readonly occurrencePaths: readonly string[];
    readonly policyOccurrencePaths: readonly string[];
    readonly writes: readonly PlannedReferenceWrite[];
  },
  Error
> => {
  const changedFiles = new Set<string>();
  const entries: RegradeReportEntry[] = [];
  const occurrencePaths: string[] = [];
  const policyOccurrencePaths: string[] = [];
  const writes: PlannedReferenceWrite[] = [];
  for (const file of params.collected.files) {
    const mappings = referenceMappingsForPath(
      file.path,
      params.renames,
      params.excludedRenameIndexes,
      params.resolved,
      params.apply,
      params.vocabularyPlan
    );
    if (mappings.safe.length === 0 && mappings.ambiguous.length === 0) {
      continue;
    }
    let source: string;
    try {
      source = readFileSync(file.absolutePath, 'utf8');
    } catch (error) {
      return Result.err(
        new InternalError(`Failed to read file reference in "${file.path}".`, {
          cause: asError(error),
        })
      );
    }
    const scopePath = params.apply
      ? sourcePathForMovedTarget(file.path, params.renames)
      : file.path;
    const policy = policyForPath(scopePath, params.scope);
    if (policy !== undefined) {
      const occurrenceStart = occurrencePaths.length;
      recordPolicyReferences({
        evidence: params.evidence,
        mappings,
        occurrencePaths,
        path: file.path,
        preserved: policy.disposition === 'explicit-preserve',
        source,
      });
      policyOccurrencePaths.push(...occurrencePaths.slice(occurrenceStart));
      continue;
    }

    const evidenceBefore = params.evidence.reduce(
      (total, item) => total + item.deferred + item.rewritten,
      0
    );
    const ambiguous = recordAmbiguousReferences(
      source,
      mappings.ambiguous,
      params.evidence
    );
    const result = astSourceExtensions.has(extname(file.path))
      ? rewriteAstReferences(source, file.path, mappings.safe, params.evidence)
      : {
          deferred: false,
          source: replaceSimultaneously(
            source,
            mappings.safe.filter(
              (mapping) => mapping.moduleSpecifierOnly !== true
            ),
            params.evidence
          ),
        };
    if (result.source === source && !result.deferred && !ambiguous) {
      continue;
    }
    const deferred = result.deferred || ambiguous;
    entries.push(referenceEntry(file.path, deferred));
    const occurrenceCount =
      params.evidence.reduce(
        (total, item) => total + item.deferred + item.rewritten,
        0
      ) - evidenceBefore;
    occurrencePaths.push(
      ...Array.from({ length: occurrenceCount }, () => file.path)
    );
    if (result.source === source) {
      continue;
    }
    writes.push({
      absolutePath: file.absolutePath,
      nextSource: result.source,
      source,
    });
    changedFiles.add(file.path);
  }
  return Result.ok({
    changedFiles,
    entries,
    occurrencePaths,
    policyOccurrencePaths,
    writes,
  });
};

const skippedCounts = (
  collected: DownstreamSourceCollection
): Readonly<Record<string, number>> =>
  Object.fromEntries(
    [...new Set(collected.skipped.map((entry) => entry.reason))].map(
      (reason) => [
        reason,
        collected.skipped.filter((entry) => entry.reason === reason).length,
      ]
    )
  );

const isGeneratedRegradeArtifactPath = (path: string): boolean =>
  /(?:^|\/)\.trails\/regrade\/.+\.json$/u.test(path);

const filterOpenedPolicyDirectories = (
  collected: DownstreamSourceCollection,
  opened: readonly string[],
  projectedTargetPaths: ReadonlySet<string>,
  scope: VocabularyRegradeScope | undefined,
  renames: readonly VocabularyFileRename[],
  apply: boolean
): DownstreamSourceCollection => {
  const files = collected.files.filter((file) => {
    const scopePath = apply
      ? sourcePathForMovedTarget(file.path, renames)
      : file.path;
    const insideOpenedDirectory = [file.path, scopePath].some((path) =>
      normalizeRenamePath(path)
        .split('/')
        .some((segment) => opened.includes(segment))
    );
    return (
      !insideOpenedDirectory ||
      projectedTargetPaths.has(normalizeRenamePath(file.path)) ||
      policyForPath(scopePath, scope) !== undefined
    );
  });
  const selected = new Set(files.map((file) => file.path));
  return {
    ...collected,
    files,
    skipped: [
      ...collected.skipped,
      ...collected.files
        .filter((file) => !selected.has(file.path))
        .map((file) => ({ path: file.path, reason: 'ignored-directory' })),
    ].toSorted((left, right) => left.path.localeCompare(right.path)),
  };
};

const collectionIncludeForFileRenames = (params: {
  readonly apply: boolean;
  readonly include: readonly string[] | undefined;
  readonly renames: readonly VocabularyFileRename[];
}): readonly string[] | undefined => {
  if (!params.apply || params.include === undefined) {
    return params.include;
  }
  return [
    ...params.include,
    ...params.renames
      .filter((rename) =>
        matchesAnyPathGlob(
          sourcePathForMovedTarget(rename.to, params.renames),
          params.include
        )
      )
      .map((rename) => rename.to),
  ];
};

const collectionExcludeForFileRenames = (params: {
  readonly apply: boolean;
  readonly exclude: readonly string[] | undefined;
  readonly renames: readonly VocabularyFileRename[];
}): readonly string[] | undefined => {
  if (!params.apply || params.exclude === undefined) {
    return params.exclude;
  }
  return [
    ...params.exclude,
    ...params.renames
      .filter((rename) =>
        matchesAnyPathGlob(
          sourcePathForMovedTarget(rename.to, params.renames),
          params.exclude
        )
      )
      .map((rename) => rename.to),
  ];
};

const normalizeExtension = (extension: string): string =>
  extension === '' || extension.startsWith('.') ? extension : `.${extension}`;

const collectionExtensionProjectionForFileRenames = (params: {
  readonly apply: boolean;
  readonly extensions: readonly string[];
  readonly renames: readonly VocabularyFileRename[];
}): {
  readonly extensions: readonly string[];
  readonly projectedTargetPaths: ReadonlySet<string>;
} => {
  const sourceExtensions = new Set(params.extensions.map(normalizeExtension));
  if (!params.apply || sourceExtensions.size === 0) {
    return {
      extensions: params.extensions,
      projectedTargetPaths: new Set(),
    };
  }
  const projectedTargetPaths = new Set(
    params.renames
      .filter((rename) =>
        sourceExtensions.has(
          extname(sourcePathForMovedTarget(rename.to, params.renames))
        )
      )
      .map((rename) => normalizeRenamePath(rename.to))
  );
  return {
    extensions: [
      ...sourceExtensions,
      ...new Set([...projectedTargetPaths].map((path) => extname(path))),
    ],
    projectedTargetPaths,
  };
};

const filterProjectedTargetExtensions = (
  collected: DownstreamSourceCollection,
  sourceExtensions: readonly string[],
  projectedTargetPaths: ReadonlySet<string>
): DownstreamSourceCollection => {
  const normalizedSourceExtensions = new Set(
    sourceExtensions.map(normalizeExtension)
  );
  if (normalizedSourceExtensions.size === 0) {
    return collected;
  }
  const files = collected.files.filter(
    (file) =>
      normalizedSourceExtensions.has(extname(file.path)) ||
      projectedTargetPaths.has(normalizeRenamePath(file.path))
  );
  const selected = new Set(files.map((file) => file.path));
  return {
    ...collected,
    files,
    skipped: [
      ...collected.skipped,
      ...collected.files
        .filter((file) => !selected.has(file.path))
        .map((file) => ({ path: file.path, reason: 'unsupported-extension' })),
    ].toSorted((left, right) => left.path.localeCompare(right.path)),
  };
};

const withExactMovedTargets = (params: {
  readonly apply: boolean;
  readonly collected: DownstreamSourceCollection;
  readonly projectedTargetPaths: ReadonlySet<string>;
  readonly renames: readonly VocabularyFileRename[];
  readonly resolved: readonly ResolvedFileRename[];
  readonly scope: VocabularyRegradeScope | undefined;
}): DownstreamSourceCollection => {
  if (!params.apply) {
    return params.collected;
  }
  const files = new Map(
    params.collected.files.map((file) => [normalizeRenamePath(file.path), file])
  );
  for (const [index, rename] of params.renames.entries()) {
    const path = normalizeRenamePath(rename.to);
    const sourcePath = sourcePathForMovedTarget(path, params.renames);
    if (
      !params.projectedTargetPaths.has(path) ||
      (params.scope?.include !== undefined &&
        !matchesAnyPathGlob(sourcePath, params.scope.include)) ||
      (params.scope?.exclude !== undefined &&
        matchesAnyPathGlob(sourcePath, params.scope.exclude)) ||
      files.has(path)
    ) {
      continue;
    }
    const absolutePath = params.resolved[index]?.to;
    if (
      absolutePath !== undefined &&
      existsSync(absolutePath) &&
      statSync(absolutePath).isFile()
    ) {
      files.set(path, { absolutePath, path });
    }
  }
  return {
    ...params.collected,
    files: [...files.values()].toSorted((left, right) =>
      left.path.localeCompare(right.path)
    ),
  };
};

/**
 * Derive review-only filename candidates without mutating source.
 *
 * @example
 * ```ts
 * const candidates = deriveFileRenameCandidates({
 *   plan: { from: 'facet', kind: 'vocabulary', to: 'trailhead' },
 *   root: process.cwd(),
 * });
 * ```
 */
export const deriveFileRenameCandidates = (params: {
  readonly plan: VocabularyRegradePlan;
  readonly root: string;
}): readonly FileRenameCandidate[] => {
  const collected = collectDownstreamSources(params.root, {
    extensions: params.plan.scope?.extensions ?? fileRenameSourceExtensions,
    ...(params.plan.scope?.exclude === undefined
      ? {}
      : { exclude: params.plan.scope.exclude }),
    ...(params.plan.scope?.include === undefined
      ? {}
      : { include: params.plan.scope.include }),
  });
  if (collected === null) {
    return [];
  }
  const safeForms = deriveVocabularyFormProposals(params.plan)
    .filter(
      (proposal): proposal is typeof proposal & { readonly to: string } =>
        proposal.kind === 'safe-rewrite' && proposal.to !== undefined
    )
    .toSorted((left, right) => right.from.length - left.from.length);
  const candidates = new Map<string, FileRenameCandidate>();
  for (const file of collected.files) {
    if (policyForPath(file.path, params.plan.scope) !== undefined) {
      continue;
    }
    let to = file.path;
    for (const form of safeForms) {
      to = to.replaceAll(
        new RegExp(
          `(?<![A-Za-z0-9_$])${escapeRegExp(form.from)}(?![A-Za-z0-9_$])`,
          params.plan.caseSensitive === true ? 'gu' : 'giu'
        ),
        form.to
      );
    }
    if (to !== file.path) {
      candidates.set(file.path, {
        evidence: [file.path],
        from: file.path,
        to,
      });
    }
  }
  return [...candidates.values()].toSorted((left, right) =>
    left.from.localeCompare(right.from)
  );
};

const changedFilesForRun = (params: {
  readonly apply: boolean;
  readonly referencePaths: ReadonlySet<string>;
  readonly renames: readonly VocabularyFileRename[];
  readonly resolved: readonly ResolvedFileRename[];
}): ReadonlySet<string> => {
  const changed = new Set(params.referencePaths);
  if (!params.apply) {
    return changed;
  }
  for (const [index, rename] of params.renames.entries()) {
    if (params.resolved[index]?.alreadyApplied !== true) {
      changed.add(normalizeRenamePath(rename.to));
    }
  }
  return changed;
};

/**
 * Preview or apply governed file moves and one derived reference-closure pass.
 *
 * @example
 * ```ts
 * const result = runFileRenameRegrade({
 *   renames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
 *   root: process.cwd(),
 * });
 * ```
 */
export const runFileRenameRegrade = (params: {
  readonly apply?: boolean;
  readonly excludeGeneratedArtifacts?: boolean;
  readonly includeEntries?: 'actionable' | 'all';
  readonly renames: readonly VocabularyFileRename[];
  readonly root: string;
  readonly scope?: VocabularyRegradeScope;
  readonly vocabularyPlan?: VocabularyRegradePlan;
}): TrailsResult<FileRenameRegradeRun, Error> => {
  const apply = params.apply === true;
  const validated = validateRenames(params.root, params.renames);
  if (validated.isErr()) {
    return validated;
  }

  const moved: TrailsResult<readonly ResolvedFileRename[], Error> = apply
    ? applyResolvedRenames(validated.value)
    : Result.ok([]);
  if (moved.isErr()) {
    return moved;
  }

  const opened = openedPolicyDirectories(params.scope);
  const include = collectionIncludeForFileRenames({
    apply,
    include: params.scope?.include,
    renames: params.renames,
  });
  const exclude = collectionExcludeForFileRenames({
    apply,
    exclude: params.scope?.exclude,
    renames: params.renames,
  });
  const sourceExtensions =
    params.scope?.extensions ?? fileRenameSourceExtensions;
  const extensionProjection = collectionExtensionProjectionForFileRenames({
    apply,
    extensions: sourceExtensions,
    renames: params.renames,
  });
  const rawCollection = collectDownstreamSources(params.root, {
    extensions: extensionProjection.extensions,
    ...(exclude === undefined ? {} : { exclude }),
    ...(include === undefined ? {} : { include }),
    ignoredDirectories: DEFAULT_IGNORED_DIRECTORIES.filter(
      (directory) => !opened.includes(directory)
    ),
  });
  if (rawCollection === null) {
    rollbackResolvedRenames(moved.value);
    return Result.err(
      new InternalError('Failed to collect file rename references.')
    );
  }
  const exactTargetCollection = withExactMovedTargets({
    apply,
    collected: rawCollection,
    projectedTargetPaths: extensionProjection.projectedTargetPaths,
    renames: params.renames,
    resolved: validated.value,
    scope: params.scope,
  });
  const extensionScopedCollection = filterProjectedTargetExtensions(
    exactTargetCollection,
    sourceExtensions,
    extensionProjection.projectedTargetPaths
  );
  const scopedCollection = filterOpenedPolicyDirectories(
    extensionScopedCollection,
    opened,
    extensionProjection.projectedTargetPaths,
    params.scope,
    params.renames,
    apply
  );
  const collected: DownstreamSourceCollection =
    params.excludeGeneratedArtifacts === true
      ? {
          ...scopedCollection,
          files: scopedCollection.files.filter(
            (file) => !isGeneratedRegradeArtifactPath(file.path)
          ),
        }
      : scopedCollection;

  const evidence = params.renames.map(() => emptyEvidence());
  const targetPaths = new Set(
    params.renames.map((rename) => normalizeRenamePath(rename.to))
  );
  const excludedRenameIndexes = new Set(
    params.renames.flatMap((rename, index) =>
      validated.value[index]?.alreadyApplied === true &&
      targetPaths.has(normalizeRenamePath(rename.from))
        ? [index]
        : []
    )
  );
  const referenceResult = rewriteReferenceFiles({
    apply,
    collected,
    evidence,
    excludedRenameIndexes,
    renames: params.renames,
    resolved: validated.value,
    ...(params.scope === undefined ? {} : { scope: params.scope }),
    ...(params.vocabularyPlan === undefined
      ? {}
      : { vocabularyPlan: params.vocabularyPlan }),
  });
  if (referenceResult.isErr()) {
    rollbackResolvedRenames(moved.value);
    return referenceResult;
  }
  if (apply) {
    const written = applyReferenceWrites(referenceResult.value.writes);
    if (written.isErr()) {
      rollbackResolvedRenames(moved.value);
      return written;
    }
  }

  const projectedEvidence = params.renames.map((rename, index) => ({
    ...rename,
    ...(evidence[index] ?? emptyEvidence()),
  }));
  const entries = [
    ...initialFileMoveEntries(params.renames, validated.value, apply),
    ...referenceResult.value.entries,
  ];
  const actionableEntries = entries.filter(
    (entry) => entry.outcome === 'rewrite' || entry.outcome === 'needs-review'
  );
  const matchedPaths = actionableEntries.map((entry) => entry.path);
  const review = entries.filter(
    (entry) => entry.outcome === 'needs-review'
  ).length;
  const rewritten = entries.filter(
    (entry) => entry.outcome === 'rewrite'
  ).length;
  const skippedByReason = skippedCounts(collected);
  const changedFiles = changedFilesForRun({
    apply,
    referencePaths: referenceResult.value.changedFiles,
    renames: params.renames,
    resolved: validated.value,
  });
  const report: RegradeReport = {
    ...(apply
      ? {
          apply: {
            applied:
              validated.value.filter((rename) => !rename.alreadyApplied)
                .length +
              projectedEvidence.reduce((sum, item) => sum + item.rewritten, 0),
            filesChanged: changedFiles.size,
            review,
            skipped: projectedEvidence.reduce(
              (sum, item) => sum + item.skipped,
              0
            ),
            unknown: 0,
          },
        }
      : {}),
    entries: params.includeEntries === 'all' ? entries : actionableEntries,
    matched: new Set(matchedPaths).size,
    review,
    rewritten,
    root: collected.root,
    scan: buildRegradeScanSummary({
      matchedPaths,
      occurrencePaths: referenceResult.value.occurrencePaths,
      scanned: collected.files.length,
      skipped: collected.skipped.length,
      skippedByReason,
    }),
    scanned: collected.files.length,
    selectedClassIds: params.renames.map(
      (rename) => `file-rename:${rename.from}->${rename.to}`
    ),
    skipped: collected.skipped.length,
    skipsByReason: skippedByReason,
    unknownClassIds: [],
  };

  return Result.ok({
    changedPaths: [...changedFiles].toSorted(),
    evidence: projectedEvidence,
    occurrencePaths: referenceResult.value.occurrencePaths,
    policyOccurrencePaths: referenceResult.value.policyOccurrencePaths,
    report,
  });
};
