#!/usr/bin/env bun
// Hard-wrap audit for markdown documentation.
//
// Flags adjacent non-blank prose lines that aren't structural (lists,
// blockquotes, tables, code, frontmatter, etc.). These render as separate
// lines (with stray spaces) in Notion / Basecamp imports.
//
// Usage:
//   bun scripts/check-hardwrap.ts                   # scan full configured scope
//   bun scripts/check-hardwrap.ts <file>...         # scan explicit files
//   bun scripts/check-hardwrap.ts --json            # machine-readable output
//
// Exits 1 if any file has hard-wrap runs, 0 otherwise.
//
// To suppress an intentional multi-line block, wrap it in:
//   <!-- prettier-ignore -->
//   ...content...
//   (blank line ends the ignore)
//
// Or place generated content between matching BEGIN/END or
// start/end sentinel comments, e.g.:
//   <!-- warden-guide:start -->  ...  <!-- warden-guide:end -->
//   <!-- error-taxonomy:start --> ... <!-- error-taxonomy:end -->
//   <!-- GENERATED: ... -->

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');

const scanRoots = ['docs', 'plugin', 'packages', 'apps', 'adapters'] as const;
const rootFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md'] as const;

// Globs intentionally excluded from the check. These are managed by other
// tools (changesets), internal planning state, or hidden agent dirs that
// don't ship to Notion/Basecamp.
const excludePatterns: readonly RegExp[] = [
  /\/CHANGELOG\.md$/,
  /^\.changeset\//,
  /^\.agents\//,
  /^\.claude\//,
  /^node_modules\//,
];

type LineKind =
  | 'blank'
  | 'heading'
  | 'list-item'
  | 'list-continuation'
  | 'blockquote'
  | 'table'
  | 'mdx-html'
  | 'directive'
  | 'footnote-body'
  | 'link-ref-def'
  | 'br-line'
  | 'prose';

interface HardWrapRange {
  readonly start: number;
  readonly end: number;
}

interface FileResult {
  readonly path: string;
  readonly ranges: readonly HardWrapRange[];
}

const listMarkdownFiles = (): readonly string[] => {
  const args = ['-l', '', '--hidden', '-t', 'md'];
  for (const root of scanRoots) {
    args.push(root);
  }
  for (const root of rootFiles) {
    args.push(root);
  }
  const out = execFileSync('rg', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((path) => !excludePatterns.some((pattern) => pattern.test(path)));
};

const SENTINEL_START =
  /<!--\s*(?:[A-Za-z0-9_:-]+:start|BEGIN[: ]|GENERATED[: ])/;
const SENTINEL_END = /<!--\s*(?:[A-Za-z0-9_:-]+:end|END[: ])/;
const PRETTIER_IGNORE = /<!--\s*prettier-ignore\s*-->/;
const CODE_FENCE = /^(```|~~~)/;
const MDX_HTML_OPEN_TAG = /^<([A-Za-z][\w.:-]*)(?:\s+[^<>]*)?>\s*$/;
const MDX_HTML_CLOSE_TAG = /<\/([A-Za-z][\w.:-]*)>/g;
const MDX_HTML_SELF_CLOSING_TAG = /^<([A-Za-z][\w.:-]*)(?:\s+[^<>]*)?\/>\s*$/;
const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

interface ScanState {
  inFrontmatter: boolean;
  inCodeFence: boolean;
  inSentinelBlock: boolean;
  inPrettierIgnore: boolean;
  mdxHtmlBlockTags: string[];
  prevKind: LineKind | null;
  runStart: number | null;
}

const initialState = (): ScanState => ({
  inCodeFence: false,
  inFrontmatter: false,
  inPrettierIgnore: false,
  inSentinelBlock: false,
  mdxHtmlBlockTags: [],
  prevKind: null,
  runStart: null,
});

const trackMdxHtmlBlock = (line: string, state: ScanState): boolean => {
  const trimmed = line.trim();
  const openMatch = trimmed.match(MDX_HTML_OPEN_TAG);
  const openingTag = openMatch?.[1];

  if (
    openingTag &&
    !HTML_VOID_TAGS.has(openingTag.toLowerCase()) &&
    !MDX_HTML_SELF_CLOSING_TAG.test(trimmed) &&
    !trimmed.includes(`</${openingTag}>`)
  ) {
    state.mdxHtmlBlockTags.push(openingTag);
  }

  const isTracked = state.mdxHtmlBlockTags.length > 0;
  for (const [, closingTag] of line.matchAll(MDX_HTML_CLOSE_TAG)) {
    if (!closingTag) {
      continue;
    }
    const openIndex = state.mdxHtmlBlockTags.lastIndexOf(closingTag);
    if (openIndex !== -1) {
      state.mdxHtmlBlockTags.length = openIndex;
    }
  }

  return isTracked;
};

// Returns true if the line was consumed by a structural toggle and the
// caller should skip downstream prose classification for this iteration.
const handleStructuralLine = (
  line: string,
  index: number,
  state: ScanState
): boolean => {
  const trimmedStart = line.trimStart();

  if (index === 0 && trimmedStart === '---') {
    state.inFrontmatter = true;
    return true;
  }
  if (state.inFrontmatter) {
    if (trimmedStart === '---') {
      state.inFrontmatter = false;
    }
    return true;
  }
  if (CODE_FENCE.test(trimmedStart)) {
    state.inCodeFence = !state.inCodeFence;
    return true;
  }
  if (state.inCodeFence) {
    return true;
  }
  if (!state.inSentinelBlock && SENTINEL_START.test(line)) {
    state.inSentinelBlock = true;
    return true;
  }
  if (state.inSentinelBlock) {
    if (SENTINEL_END.test(line)) {
      state.inSentinelBlock = false;
    }
    return true;
  }
  if (PRETTIER_IGNORE.test(line)) {
    state.inPrettierIgnore = true;
    return true;
  }
  return false;
};

const classifyLine = (line: string, state: ScanState): LineKind => {
  if (trackMdxHtmlBlock(line, state)) {
    return 'mdx-html';
  }

  const trimmed = line.trim();
  if (trimmed === '') {
    return 'blank';
  }
  const trimmedStart = line.trimStart();

  // Trailing-double-space `<br>` line break (intentional, preserve)
  if (line.endsWith('  ')) {
    return 'br-line';
  }
  if (trimmedStart.startsWith('#')) {
    return 'heading';
  }
  if (trimmedStart.startsWith('>')) {
    return 'blockquote';
  }
  // Tables: lines containing pipe (crude but works for our content)
  if (trimmedStart.includes('|') && line === trimmedStart) {
    return 'table';
  }
  // Footnote bodies and link reference definitions take priority over
  // generic list detection (both start with `[`).
  if (/^\[\^[^\]]+\]:/.test(trimmedStart)) {
    return 'footnote-body';
  }
  if (/^\[[^\]]+\]:\s/.test(trimmedStart)) {
    return 'link-ref-def';
  }
  if (/^[-*+]\s/.test(trimmedStart)) {
    return 'list-item';
  }
  if (/^\d+[.)]\s/.test(trimmedStart)) {
    return 'list-item';
  }
  if (/^[=-]+\s*$/.test(trimmedStart)) {
    return 'heading';
  }
  if (trimmedStart.startsWith('<')) {
    return 'mdx-html';
  }
  if (trimmedStart.startsWith(':::')) {
    return 'directive';
  }
  // Any other indented non-empty line: treat as structural continuation.
  // Covers multi-paragraph list-item bodies, footnote-body continuations,
  // indented code blocks, and indented prose under any structural parent.
  if (line.startsWith(' ')) {
    return 'list-continuation';
  }
  return 'prose';
};

const mergeRanges = (
  ranges: readonly HardWrapRange[]
): readonly HardWrapRange[] => {
  const merged: HardWrapRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 1) {
      merged[merged.length - 1] = {
        end: Math.max(last.end, range.end),
        start: last.start,
      };
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
};

const scanFile = (content: string): readonly HardWrapRange[] => {
  const lines = content.split(/\r?\n/);
  const ranges: HardWrapRange[] = [];
  const state = initialState();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const lineNum = i + 1;

    if (handleStructuralLine(line, i, state)) {
      state.prevKind = null;
      state.runStart = null;
      continue;
    }

    const kind = classifyLine(line, state);

    if (state.inPrettierIgnore) {
      if (line.trim() === '') {
        state.inPrettierIgnore = false;
      }
      state.prevKind = kind;
      state.runStart = null;
      continue;
    }

    if (kind === 'prose' && state.prevKind === 'prose') {
      if (state.runStart === null) {
        state.runStart = lineNum - 1;
      }
      ranges.push({ end: lineNum, start: state.runStart });
    } else {
      state.runStart = null;
    }

    state.prevKind = kind;
  }

  return mergeRanges(ranges);
};

const printText = (results: readonly FileResult[], filesScanned: number) => {
  const sorted = [...results].toSorted((a, b) => {
    if (b.ranges.length !== a.ranges.length) {
      return b.ranges.length - a.ranges.length;
    }
    return a.path.localeCompare(b.path);
  });
  for (const result of sorted) {
    const ranges = result.ranges
      .map((range) => `${range.start}-${range.end}`)
      .join(',');
    process.stdout.write(
      `${result.ranges.length}\t${result.path}\t${ranges}\n`
    );
  }
  process.stdout.write('---\n');
  process.stdout.write(`files-with-runs: ${results.length}\n`);
  process.stdout.write(`files-scanned:   ${filesScanned}\n`);
};

const printJson = (results: readonly FileResult[], filesScanned: number) => {
  process.stdout.write(
    `${JSON.stringify(
      {
        filesScanned,
        filesWithHits: results.length,
        results,
      },
      null,
      2
    )}\n`
  );
};

const main = () => {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const explicitFiles = args.filter((arg) => !arg.startsWith('--'));

  const candidates =
    explicitFiles.length > 0
      ? explicitFiles.map((path) => relative(repoRoot, resolve(repoRoot, path)))
      : listMarkdownFiles();

  const results: FileResult[] = [];
  let filesScanned = 0;
  for (const path of candidates) {
    let content: string;
    try {
      content = readFileSync(resolve(repoRoot, path), 'utf8');
    } catch (error) {
      if (explicitFiles.length > 0) {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `Warning: unable to read explicit file ${path}: ${detail}\n`
        );
      }
      continue;
    }
    filesScanned += 1;
    const ranges = scanFile(content);
    if (ranges.length > 0) {
      results.push({ path, ranges });
    }
  }

  if (jsonMode) {
    printJson(results, filesScanned);
  } else {
    printText(results, filesScanned);
  }

  const allExplicitUnreadable = explicitFiles.length > 0 && filesScanned === 0;

  if (results.length > 0) {
    if (!jsonMode) {
      process.stderr.write(
        '\nHard-wrapped paragraphs found. Reflow each paragraph onto a single line.\n'
      );
      process.stderr.write('To suppress an intentional multi-line block:\n');
      process.stderr.write(
        '  <!-- prettier-ignore -->\n  ...content...\n  (blank line ends the ignore)\n'
      );
    }
    process.exit(1);
  }

  if (allExplicitUnreadable) {
    process.exit(1);
  }
};

main();
