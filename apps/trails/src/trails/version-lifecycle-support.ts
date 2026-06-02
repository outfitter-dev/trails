import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Result, ValidationError } from '@ontrails/core';
import type { AnyTrail, Topo } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';
import type { TopoGraph, TopoGraphForceEntry } from '@ontrails/topographer';
import { findTrailDefinitions, parse } from '@ontrails/warden/ast';

import { tryLoadFreshAppLease } from './load-app.js';
import {
  readLifecycleSourceFile,
  writeLifecycleSourceFile,
} from '../lifecycle-source-io.js';
import { resolveTrailRootDir } from './root-dir.js';

export type LifecycleEntryKind = 'revision' | 'fork';
export type LifecycleStatusKind = 'deprecated' | 'archived';

export interface LifecycleCommandInput {
  readonly module?: string | undefined;
  readonly rootDir?: string | undefined;
  readonly target?: string | undefined;
}

export interface LifecycleWriteResult {
  readonly file: string;
  readonly trailId: string;
  readonly updated: boolean;
  readonly warnings?: readonly string[] | undefined;
}

interface TrailSourceMatch {
  readonly configEnd: number;
  readonly configStart: number;
  readonly filePath: string;
  readonly source: string;
}

interface PropertyMatch {
  readonly end: number;
  readonly key: string;
  readonly start: number;
  readonly value: string;
  readonly valueEnd: number;
  readonly valueStart: number;
}

interface ParsedVersionTarget {
  readonly trailId: string;
  readonly version?: number | undefined;
}

const managedSourceGlob = new Bun.Glob('src/**/*.ts');

const literal = (value: string): string => JSON.stringify(value);

const parseVersionTarget = (
  target: string
): Result<ParsedVersionTarget, Error> => {
  const separator = target.lastIndexOf('@');
  if (separator === -1) {
    return Result.ok({ trailId: target });
  }
  const trailId = target.slice(0, separator);
  const rawVersion = target.slice(separator + 1);
  const version = Number(rawVersion);
  if (
    trailId.length === 0 ||
    !Number.isInteger(version) ||
    version < 1 ||
    String(version) !== rawVersion
  ) {
    return Result.err(
      new ValidationError('Version target must use trail.id@positiveInteger')
    );
  }
  return Result.ok({ trailId, version });
};

const scanManagedSourceFiles = (rootDir: string): readonly string[] =>
  [...managedSourceGlob.scanSync({ cwd: rootDir, onlyFiles: true })]
    .map((path) => join(rootDir, path))
    .toSorted();

const findTrailSource = (
  rootDir: string,
  trailId: string
): Result<TrailSourceMatch, Error> => {
  for (const filePath of scanManagedSourceFiles(rootDir)) {
    if (!existsSync(filePath)) {
      continue;
    }
    const source = readLifecycleSourceFile(filePath);
    if (source.isErr()) {
      return source;
    }
    if (!source.value.includes(trailId)) {
      continue;
    }
    const ast = parse(filePath, source.value);
    if (!ast) {
      continue;
    }
    const match = findTrailDefinitions(ast).find(
      (definition) => definition.kind === 'trail' && definition.id === trailId
    );
    if (match !== undefined) {
      return Result.ok({
        configEnd: match.config.end,
        configStart: match.config.start,
        filePath,
        source: source.value,
      });
    }
  }

  return Result.err(
    new ValidationError(`Could not find source trail definition for ${trailId}`)
  );
};

const isWhitespace = (ch: string | undefined): boolean =>
  ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';

const scanPropertyValueEnd = (
  source: string,
  start: number,
  end: number
): number => {
  const state: {
    depth: number;
    escaped: boolean;
    quote: '"' | "'" | undefined;
    skipNext: boolean;
    templateStack: number[];
  } = {
    depth: 0,
    escaped: false,
    quote: undefined,
    skipNext: false,
    templateStack: [],
  };
  const currentTemplateDepth = (): number | undefined =>
    state.templateStack.length === 0 ? undefined : state.templateStack.at(-1);
  const consumeQuoted = (ch: string | undefined): boolean => {
    if (state.quote === undefined) {
      return false;
    }
    if (state.escaped) {
      state.escaped = false;
    } else if (ch === '\\') {
      state.escaped = true;
    } else if (ch === state.quote) {
      state.quote = undefined;
    }
    return true;
  };
  const consumeTemplateText = (
    ch: string | undefined,
    next: string | undefined
  ): boolean => {
    if (currentTemplateDepth() !== 0) {
      return false;
    }
    if (state.escaped) {
      state.escaped = false;
    } else if (ch === '\\') {
      state.escaped = true;
    } else if (ch === '`') {
      state.templateStack.pop();
    } else if (ch === '$' && next === '{') {
      state.templateStack[state.templateStack.length - 1] = 1;
      state.depth += 1;
      state.skipNext = true;
    }
    return true;
  };
  const consumeOpen = (ch: string | undefined): boolean => {
    if (ch !== '(' && ch !== '{' && ch !== '[') {
      return false;
    }
    const templateDepth = currentTemplateDepth();
    state.depth += 1;
    if (templateDepth !== undefined && ch === '{') {
      state.templateStack[state.templateStack.length - 1] = templateDepth + 1;
    }
    return true;
  };
  const consumeClose = (ch: string | undefined): boolean => {
    if (ch !== ')' && ch !== '}' && ch !== ']') {
      return false;
    }
    const templateDepth = currentTemplateDepth();
    state.depth -= 1;
    if (templateDepth !== undefined && ch === '}') {
      state.templateStack[state.templateStack.length - 1] = templateDepth - 1;
    }
    return true;
  };

  for (let index = start; index < end; index += 1) {
    const ch = source[index];
    if (consumeQuoted(ch) || consumeTemplateText(ch, source[index + 1])) {
      if (state.skipNext) {
        state.skipNext = false;
        index += 1;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      state.quote = ch;
      continue;
    }
    if (ch === '`') {
      state.templateStack.push(0);
      continue;
    }
    if (consumeOpen(ch)) {
      continue;
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      if (state.depth === 0) {
        return index;
      }
      consumeClose(ch);
      continue;
    }
    if (ch === ',' && state.depth === 0) {
      return index;
    }
  }
  let valueEnd = end;
  while (valueEnd > start && isWhitespace(source[valueEnd - 1])) {
    valueEnd -= 1;
  }
  return valueEnd;
};

const skipIgnored = (source: string, start: number, end: number): number => {
  let index = start;
  while (index < end) {
    const ch = source[index];
    if (isWhitespace(ch)) {
      index += 1;
      continue;
    }
    if (ch === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? end : nextLine + 1;
      continue;
    }
    if (ch === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? end : commentEnd + 2;
      continue;
    }
    break;
  }
  return index;
};

const isIdentifierStart = (ch: string | undefined): boolean =>
  ch !== undefined && /^[A-Za-z_$]$/.test(ch);

const isIdentifierPart = (ch: string | undefined): boolean =>
  ch !== undefined && /^[A-Za-z0-9_$]$/.test(ch);

const readIdentifierKey = (
  source: string,
  start: number
): { readonly key: string; readonly keyEnd: number } | undefined => {
  if (!isIdentifierStart(source[start])) {
    return undefined;
  }
  let keyEnd = start + 1;
  while (isIdentifierPart(source[keyEnd])) {
    keyEnd += 1;
  }
  return { key: source.slice(start, keyEnd), keyEnd };
};

const readQuotedKey = (
  source: string,
  start: number,
  end: number
): { readonly key: string; readonly keyEnd: number } | undefined => {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }
  let escaped = false;
  let key = '';
  for (let index = start + 1; index < end; index += 1) {
    const ch = source[index];
    if (escaped) {
      key += ch ?? '';
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === quote) {
      return { key, keyEnd: index + 1 };
    }
    key += ch ?? '';
  }
  return undefined;
};

const readNumericKey = (
  source: string,
  start: number
): { readonly key: string; readonly keyEnd: number } | undefined => {
  if (source[start] === undefined || !/^\d$/.test(source[start] ?? '')) {
    return undefined;
  }
  let keyEnd = start + 1;
  while (/^\d$/.test(source[keyEnd] ?? '')) {
    keyEnd += 1;
  }
  return { key: source.slice(start, keyEnd), keyEnd };
};

const readPropertyKey = (
  source: string,
  start: number,
  end: number
): { readonly key: string; readonly keyEnd: number } | undefined =>
  readIdentifierKey(source, start) ??
  readQuotedKey(source, start, end) ??
  readNumericKey(source, start);

const propertyLineStart = (source: string, keyStart: number): number => {
  const lineStart = source.lastIndexOf('\n', keyStart) + 1;
  return source.slice(lineStart, keyStart).trim().length === 0
    ? lineStart
    : keyStart;
};

const findConfigProperty = (
  match: TrailSourceMatch,
  key: string
): PropertyMatch | undefined => {
  const bodyStart = match.configStart + 1;
  const bodyEnd =
    match.source[match.configEnd - 1] === '}'
      ? match.configEnd - 1
      : match.configEnd;
  let index = bodyStart;

  while (index < bodyEnd) {
    index = skipIgnored(match.source, index, bodyEnd);
    if (match.source[index] === ',') {
      index += 1;
      continue;
    }

    const keyStart = index;
    const propertyKey = readPropertyKey(match.source, keyStart, bodyEnd);
    if (propertyKey === undefined) {
      const valueEnd = scanPropertyValueEnd(match.source, keyStart, bodyEnd);
      index = match.source[valueEnd] === ',' ? valueEnd + 1 : valueEnd;
      continue;
    }

    const colon = skipIgnored(match.source, propertyKey.keyEnd, bodyEnd);
    if (match.source[colon] !== ':') {
      const valueEnd = scanPropertyValueEnd(match.source, keyStart, bodyEnd);
      index = match.source[valueEnd] === ',' ? valueEnd + 1 : valueEnd;
      continue;
    }

    const valueStart = colon + 1;
    const valueEnd = scanPropertyValueEnd(match.source, valueStart, bodyEnd);
    if (propertyKey.key === key) {
      const end = match.source[valueEnd] === ',' ? valueEnd + 1 : valueEnd;
      return {
        end,
        key,
        start: propertyLineStart(match.source, keyStart),
        value: match.source.slice(valueStart, valueEnd).trim(),
        valueEnd,
        valueStart,
      };
    }
    index = match.source[valueEnd] === ',' ? valueEnd + 1 : valueEnd;
  }

  return undefined;
};

const replaceRange = (
  source: string,
  start: number,
  end: number,
  replacement: string
): string => `${source.slice(0, start)}${replacement}${source.slice(end)}`;

const coreNamedImportPattern =
  /import\s+(?<importKind>type\s+)?\{(?<imports>[^}]*)\}\s*from\s*['"]@ontrails\/core['"]/g;

const declaresRuntimeResultBinding = (specifier: string): boolean => {
  const trimmed = specifier.trim();
  if (trimmed.startsWith('type ')) {
    return false;
  }
  const [imported, local] = trimmed.split(/\s+as\s+/);
  return imported === 'Result' && (local === undefined || local === 'Result');
};

const hasDirectResultImport = (source: string): boolean => {
  for (const match of source.matchAll(coreNamedImportPattern)) {
    if (match.groups?.['importKind'] !== undefined) {
      continue;
    }
    const imports = match.groups?.['imports'];
    if (
      imports
        ?.split(',')
        .some((specifier) => declaresRuntimeResultBinding(specifier)) === true
    ) {
      return true;
    }
  }
  return false;
};

const missingResultImportWarning = (source: string): readonly string[] =>
  hasDirectResultImport(source)
    ? []
    : [
        'Fork blaze placeholder references Result.err, but this file does not import Result from @ontrails/core.',
      ];

const lineIndentAt = (source: string, index: number): string => {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const nextLine = source.indexOf('\n', lineStart);
  const lineEnd = nextLine === -1 ? source.length : nextLine;
  return /^\s*/.exec(source.slice(lineStart, lineEnd))?.[0] ?? '';
};

const propertyObjectStart = (source: string, entry: PropertyMatch): number => {
  const start = source.indexOf('{', entry.valueStart);
  return start === -1 ? entry.valueStart : start;
};

const propertyObjectCloseLineStart = (
  source: string,
  entry: PropertyMatch
): number => {
  const close = source.lastIndexOf('}', entry.valueEnd);
  return source.lastIndexOf('\n', close) + 1;
};

const buildVersionEntry = (
  version: number,
  kind: LifecycleEntryKind,
  input: string,
  output: string,
  blaze: string | undefined
): string => {
  if (kind === 'fork') {
    return `    ${version}: {
      input: ${input},
      output: ${output},
      blaze: ${blaze ?? 'async () => Result.err(new Error("TODO: implement fork blaze"))'},
    },`;
  }

  return `    ${version}: {
      input: ${input},
      output: ${output},
      transpose: {
        input: ({ input }) => input as never,
        output: ({ output }) => output as never,
      },
    },`;
};

const insertVersionEntry = (
  source: string,
  match: TrailSourceMatch,
  entry: string
): string => {
  const versions = findConfigProperty(match, 'versions');
  if (versions === undefined) {
    const insertAt = match.configEnd - 1;
    return replaceRange(
      source,
      insertAt,
      insertAt,
      `  versions: {\n${entry}\n  },\n`
    );
  }

  const open = source.indexOf('{', versions.valueStart);
  return replaceRange(source, open + 1, open + 1, `\n${entry}`);
};

const upsertCurrentVersion = (
  source: string,
  match: TrailSourceMatch,
  nextVersion: number
): string => {
  const existing = findConfigProperty(match, 'version');
  if (existing !== undefined) {
    return replaceRange(
      source,
      existing.valueStart,
      existing.valueEnd,
      ` ${nextVersion}`
    );
  }
  const insertAt = match.configStart + 1;
  return replaceRange(
    source,
    insertAt,
    insertAt,
    `\n  version: ${nextVersion},`
  );
};

export const reviseTrailSource = (
  rootDir: string,
  trail: AnyTrail,
  kind: LifecycleEntryKind
): Result<LifecycleWriteResult, Error> => {
  const match = findTrailSource(rootDir, trail.id);
  if (match.isErr()) {
    return match;
  }
  const input = findConfigProperty(match.value, 'input');
  const output = findConfigProperty(match.value, 'output');
  if (input === undefined || output === undefined) {
    return Result.err(
      new ValidationError(`Trail ${trail.id} must declare input and output`)
    );
  }

  const currentVersion = trail.version ?? 1;
  const nextVersion = currentVersion + 1;
  const blaze = findConfigProperty(match.value, 'blaze');
  const usesForkPlaceholder = kind === 'fork' && blaze?.value === undefined;
  let nextSource = upsertCurrentVersion(
    match.value.source,
    match.value,
    nextVersion
  );
  const shiftedMatch = {
    ...match.value,
    configEnd:
      match.value.configEnd + (nextSource.length - match.value.source.length),
    source: nextSource,
  };
  nextSource = insertVersionEntry(
    nextSource,
    shiftedMatch,
    buildVersionEntry(
      currentVersion,
      kind,
      input.value,
      output.value,
      blaze?.value
    )
  );
  const written = writeLifecycleSourceFile(match.value.filePath, nextSource);
  if (written.isErr()) {
    return Result.err(written.error);
  }

  return Result.ok({
    file: match.value.filePath,
    trailId: trail.id,
    updated: true,
    ...(usesForkPlaceholder
      ? { warnings: missingResultImportWarning(match.value.source) }
      : {}),
  });
};

interface ForkVersionEntryRewrite {
  readonly source: string;
  readonly usedPlaceholder: boolean;
}

const forkVersionEntry = (
  source: string,
  match: TrailSourceMatch,
  entry: PropertyMatch
): ForkVersionEntryRewrite => {
  const entryMatch: TrailSourceMatch = {
    ...match,
    configEnd: entry.valueEnd,
    configStart: propertyObjectStart(source, entry),
  };
  const forkBlaze =
    'blaze: async () => Result.err(new Error("TODO: implement fork blaze"))';
  const transpose = findConfigProperty(entryMatch, 'transpose');
  if (transpose !== undefined) {
    const indent = lineIndentAt(source, transpose.start);
    return {
      source: replaceRange(
        source,
        transpose.start,
        transpose.end,
        `${indent}${forkBlaze},`
      ),
      usedPlaceholder: true,
    };
  }
  const blaze = findConfigProperty(entryMatch, 'blaze');
  if (blaze !== undefined) {
    return { source, usedPlaceholder: false };
  }
  return {
    source: replaceRange(
      source,
      propertyObjectCloseLineStart(source, entry),
      propertyObjectCloseLineStart(source, entry),
      `      ${forkBlaze},\n`
    ),
    usedPlaceholder: true,
  };
};

const statusBlock = (
  status: LifecycleStatusKind,
  input: {
    readonly migration?: readonly string[] | undefined;
    readonly note?: string | undefined;
    readonly reason?: string | undefined;
    readonly successor?: number | undefined;
  }
): string => {
  if (status === 'archived') {
    return `status: { state: 'archived'${input.reason ? `, reason: ${literal(input.reason)}` : ''} }`;
  }
  const migration =
    input.migration === undefined || input.migration.length === 0
      ? ''
      : `, migration: [${input.migration.map(literal).join(', ')}]`;
  const successor =
    input.successor === undefined ? '' : `, successor: ${input.successor}`;
  const note = input.note === undefined ? '' : `, note: ${literal(input.note)}`;
  return `status: { state: 'deprecated'${successor}${migration}${note} }`;
};

const findVersionEntryProperty = (
  match: TrailSourceMatch,
  version: number
): PropertyMatch | undefined => {
  const versions = findConfigProperty(match, 'versions');
  if (versions === undefined) {
    return undefined;
  }
  const configStart = propertyObjectStart(match.source, versions);
  const entry = findConfigProperty(
    {
      ...match,
      configEnd: versions.valueEnd,
      configStart,
    },
    String(version)
  );
  if (entry === undefined) {
    return undefined;
  }
  return entry;
};

export const setVersionStatusSource = (
  rootDir: string,
  target: ParsedVersionTarget,
  status: LifecycleStatusKind,
  input: {
    readonly migration?: readonly string[] | undefined;
    readonly note?: string | undefined;
    readonly reason?: string | undefined;
    readonly successor?: number | undefined;
  }
): Result<LifecycleWriteResult, Error> => {
  if (target.version === undefined) {
    return Result.err(
      new ValidationError(
        'Deprecate requires an explicit trail.id@version target'
      )
    );
  }
  const match = findTrailSource(rootDir, target.trailId);
  if (match.isErr()) {
    return match;
  }
  const entry = findVersionEntryProperty(match.value, target.version);
  if (entry === undefined) {
    return Result.err(
      new ValidationError(
        `Trail ${target.trailId} does not declare version ${target.version}`
      )
    );
  }
  const fakeEntryMatch: TrailSourceMatch = {
    ...match.value,
    configEnd: entry.valueEnd,
    configStart: propertyObjectStart(match.value.source, entry),
  };
  const existing = findConfigProperty(fakeEntryMatch, 'status');
  const nextStatus = statusBlock(status, input);
  const nextSource =
    existing === undefined
      ? replaceRange(
          match.value.source,
          propertyObjectCloseLineStart(match.value.source, entry),
          propertyObjectCloseLineStart(match.value.source, entry),
          `      ${nextStatus},\n`
        )
      : replaceRange(
          match.value.source,
          existing.start,
          existing.end,
          `${lineIndentAt(match.value.source, existing.start)}${nextStatus},`
        );
  if (nextSource === match.value.source) {
    return Result.ok({
      file: match.value.filePath,
      trailId: target.trailId,
      updated: false,
    });
  }
  const written = writeLifecycleSourceFile(match.value.filePath, nextSource);
  if (written.isErr()) {
    return Result.err(written.error);
  }

  return Result.ok({
    file: match.value.filePath,
    trailId: target.trailId,
    updated: true,
  });
};

export const forkVersionEntrySource = (
  rootDir: string,
  target: ParsedVersionTarget
): Result<LifecycleWriteResult, Error> => {
  if (target.version === undefined) {
    return Result.err(
      new ValidationError(
        'Forking a historical entry requires trail.id@version'
      )
    );
  }
  const match = findTrailSource(rootDir, target.trailId);
  if (match.isErr()) {
    return match;
  }
  const entry = findVersionEntryProperty(match.value, target.version);
  if (entry === undefined) {
    return Result.err(
      new ValidationError(
        `Trail ${target.trailId} does not declare version ${target.version}`
      )
    );
  }
  const rewrite = forkVersionEntry(match.value.source, match.value, entry);
  const nextSource = rewrite.source;
  if (nextSource === match.value.source) {
    return Result.ok({
      file: match.value.filePath,
      trailId: target.trailId,
      updated: false,
    });
  }
  const written = writeLifecycleSourceFile(match.value.filePath, nextSource);
  if (written.isErr()) {
    return Result.err(written.error);
  }

  return Result.ok({
    file: match.value.filePath,
    trailId: target.trailId,
    updated: true,
    ...(rewrite.usedPlaceholder
      ? { warnings: missingResultImportWarning(match.value.source) }
      : {}),
  });
};

export const parseLifecycleTarget = parseVersionTarget;

export const withLifecycleApp = async <T>(
  input: LifecycleCommandInput,
  cwd: string | undefined,
  consume: (
    app: Topo,
    rootDir: string
  ) => Result<T, Error> | Promise<Result<T, Error>>
): Promise<Result<T, Error>> => {
  const root = resolveTrailRootDir(input.rootDir, cwd);
  if (root.isErr()) {
    return root;
  }
  const lease = await tryLoadFreshAppLease(input.module, root.value);
  if (lease.isErr()) {
    return Result.err(lease.error);
  }
  try {
    return await consume(lease.value.app, root.value);
  } finally {
    lease.value.release();
  }
};

export const findLifecycleTrail = (
  app: Topo,
  trailId: string
): Result<AnyTrail, Error> => {
  const found = app.get(trailId);
  return found === undefined
    ? Result.err(new ValidationError(`Trail not found: ${trailId}`))
    : Result.ok(found as AnyTrail);
};

export interface DoctorForceDetail extends TopoGraphForceEntry {
  readonly scope: 'entry' | 'graph';
}

export interface DoctorSummary {
  readonly archived: number;
  readonly deprecated: number;
  readonly forceDetails: readonly DoctorForceDetail[];
  readonly forceEvents: number;
  readonly mode: 'doctor';
  readonly trails: number;
  readonly versioned: number;
}

const doctorForceKey = (force: TopoGraphForceEntry): string =>
  JSON.stringify([
    force.kind,
    force.id,
    force.change,
    force.detail,
    force.reason,
    force.severity,
    force.source,
  ]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isDoctorForceEntry = (value: unknown): value is TopoGraphForceEntry =>
  isRecord(value) &&
  typeof value['acceptedAt'] === 'string' &&
  (value['change'] === 'modified' || value['change'] === 'removed') &&
  typeof value['detail'] === 'string' &&
  typeof value['id'] === 'string' &&
  (value['kind'] === 'contour' ||
    value['kind'] === 'trail' ||
    value['kind'] === 'signal' ||
    value['kind'] === 'resource') &&
  (value['reason'] === undefined || typeof value['reason'] === 'string') &&
  value['severity'] === 'breaking' &&
  value['source'] === 'trails compile --force';

const doctorForceEntries = (value: unknown): readonly TopoGraphForceEntry[] =>
  Array.isArray(value) ? value.filter(isDoctorForceEntry) : [];

const pushDoctorForceDetail = (
  details: DoctorForceDetail[],
  seen: Set<string>,
  force: TopoGraphForceEntry,
  scope: DoctorForceDetail['scope']
): void => {
  const key = doctorForceKey(force);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  details.push({
    acceptedAt: force.acceptedAt,
    change: force.change,
    detail: force.detail,
    id: force.id,
    kind: force.kind,
    ...(force.reason === undefined ? {} : { reason: force.reason }),
    scope,
    severity: force.severity,
    source: force.source,
  });
};

const collectDoctorForceDetails = (
  graph: TopoGraph
): readonly DoctorForceDetail[] => {
  const details: DoctorForceDetail[] = [];
  const seen = new Set<string>();
  for (const entry of graph.entries) {
    for (const force of doctorForceEntries(entry.forces)) {
      pushDoctorForceDetail(details, seen, force, 'entry');
    }
  }
  for (const force of doctorForceEntries(graph.forces)) {
    pushDoctorForceDetail(details, seen, force, 'graph');
  }
  return details;
};

export const deriveDoctorSummary = (
  app: Topo,
  options?: { readonly forceGraph?: TopoGraph | null | undefined }
): DoctorSummary => {
  const graph = deriveTopoGraph(app);
  const forceDetails = collectDoctorForceDetails(options?.forceGraph ?? graph);
  let archived = 0;
  let deprecated = 0;
  let versioned = 0;
  for (const entry of graph.entries) {
    if (entry.kind !== 'trail') {
      continue;
    }
    if (entry.version !== undefined) {
      versioned += 1;
    }
    for (const version of Object.values(entry.versions ?? {})) {
      if (version.status?.state === 'archived') {
        archived += 1;
      } else if (version.status?.state === 'deprecated') {
        deprecated += 1;
      }
    }
  }
  return {
    archived,
    deprecated,
    forceDetails,
    forceEvents: forceDetails.length,
    mode: 'doctor',
    trails: app.list().length,
    versioned,
  };
};
