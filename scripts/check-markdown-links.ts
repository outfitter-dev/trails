import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path';

export interface MarkdownLink {
  readonly line: number;
  readonly target: string;
  readonly text: string;
}

export interface LinkCheckFailure extends MarkdownLink {
  readonly message: string;
  readonly sourcePath: string;
}

interface ParsedTarget {
  readonly anchor: string;
  readonly path: string;
}

interface MarkdownFence {
  readonly length: number;
  readonly marker: '`' | '~';
}

interface LinkCheckOptions {
  readonly readAnchors?: (path: string) => ReadonlySet<string>;
  readonly targetExists?: (path: string) => boolean;
}

const repoRoot = resolve(import.meta.dir, '..');
const scanRoots = ['docs', 'packages', 'apps', 'adapters'] as const;
const markdownExtensions = new Set(['.md', '.mdx']);
const externalSchemePattern = /^[a-z][a-z0-9+.-]*:/i;

const isMarkdownFile = (path: string) =>
  markdownExtensions.has(extname(path).toLowerCase()) &&
  !path.endsWith('/CHANGELOG.md');

const walkMarkdownFiles = (root: string): readonly string[] => {
  const absoluteRoot = join(repoRoot, root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const files: string[] = [];
  const visit = (absolutePath: string) => {
    const entries = readdirSync(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.turbo'
      ) {
        continue;
      }

      const child = join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }

      const relativePath = relative(repoRoot, child);
      if (entry.isFile() && isMarkdownFile(relativePath)) {
        files.push(relativePath);
      }
    }
  };

  visit(absoluteRoot);
  return files.toSorted();
};

export const discoverMarkdownFiles = (): readonly string[] =>
  scanRoots.flatMap(walkMarkdownFiles).sort();

const stripInlineCode = (line: string) =>
  line.replaceAll(/`[^`]*`/g, (match) => ' '.repeat(match.length));

const parseDestination = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>');
    return close === -1 ? trimmed.slice(1) : trimmed.slice(1, close);
  }

  const whitespace = /\s/.exec(trimmed);
  return whitespace ? trimmed.slice(0, whitespace.index) : trimmed;
};

const collectReferenceDefinitions = (
  line: string,
  lineNumber: number
): readonly MarkdownLink[] => {
  const match = /^\s{0,3}\[([^\]]+)]:\s+(\S.*)$/.exec(line);
  if (!match) {
    return [];
  }

  if (match[1].startsWith('^')) {
    return [];
  }

  return [
    {
      line: lineNumber,
      target: parseDestination(match[2]),
      text: match[1],
    },
  ];
};

const collectInlineLinks = (
  line: string,
  lineNumber: number
): readonly MarkdownLink[] => {
  const stripped = stripInlineCode(line);
  const links: MarkdownLink[] = [];
  const pattern = /!?\[([^\]\n]+)]\(([^)\n]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stripped))) {
    links.push({
      line: lineNumber,
      target: parseDestination(match[2]),
      text: match[1].trim(),
    });
  }

  return links;
};

const updateFenceState = (
  line: string,
  fence: MarkdownFence | null
): { readonly fence: MarkdownFence | null; readonly matched: boolean } => {
  const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!fenceMatch) {
    return { fence, matched: false };
  }

  const [, fenceMarker] = fenceMatch;
  const [marker] = fenceMarker as '`' | '~';
  const { length } = fenceMarker;
  if (!fence) {
    return { fence: { length, marker }, matched: true };
  }

  if (fence.marker === marker && length >= fence.length) {
    return { fence: null, matched: true };
  }
  return { fence, matched: true };
};

export const extractMarkdownLinks = (
  markdown: string
): readonly MarkdownLink[] => {
  const links: MarkdownLink[] = [];
  const lines = markdown.split('\n');
  let fence: MarkdownFence | null = null;

  for (const [index, line] of lines.entries()) {
    const nextFence = updateFenceState(line, fence);
    ({ fence } = nextFence);
    if (nextFence.matched) {
      continue;
    }

    if (fence) {
      continue;
    }

    const lineNumber = index + 1;
    links.push(...collectReferenceDefinitions(line, lineNumber));
    links.push(...collectInlineLinks(line, lineNumber));
  }

  return links;
};

const stripMarkdownForAnchor = (heading: string) =>
  heading
    .replaceAll(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replaceAll(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replaceAll(/`([^`]+)`/g, '$1')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll(/[*_~]/g, '');

const githubAnchorBase = (heading: string) =>
  stripMarkdownForAnchor(heading)
    .trim()
    .toLowerCase()
    .replaceAll('&amp;', '')
    .replaceAll(/[^a-z0-9 _-]/g, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-');

export const collectAnchors = (markdown: string): ReadonlySet<string> => {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  let fence: MarkdownFence | null = null;

  for (const line of markdown.split('\n')) {
    const nextFence = updateFenceState(line, fence);
    ({ fence } = nextFence);
    if (nextFence.matched || fence) {
      continue;
    }

    const match = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const base = githubAnchorBase(match[1]);
    if (!base) {
      continue;
    }

    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }

  return anchors;
};

const parseTarget = (target: string): ParsedTarget => {
  const hashIndex = target.indexOf('#');
  if (hashIndex === -1) {
    return { anchor: '', path: target };
  }

  return {
    anchor: target.slice(hashIndex + 1),
    path: target.slice(0, hashIndex),
  };
};

const isExternalTarget = (target: string) =>
  externalSchemePattern.test(target) || target.startsWith('//');

const normalizeAnchor = (anchor: string) =>
  decodeURIComponent(anchor).trim().toLowerCase();

const targetPathFor = (sourcePath: string, targetPath: string) => {
  if (targetPath.length === 0) {
    return sourcePath;
  }

  const decodedPath = decodeURIComponent(targetPath.split('?')[0]);
  const absoluteTarget = decodedPath.startsWith('/')
    ? join(repoRoot, decodedPath.slice(1))
    : join(repoRoot, dirname(sourcePath), decodedPath);

  return normalize(relative(repoRoot, absoluteTarget));
};

const readAnchors = (path: string): ReadonlySet<string> => {
  const absolutePath = join(repoRoot, path);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    return new Set();
  }

  return collectAnchors(readFileSync(absolutePath, 'utf8'));
};

export const checkMarkdownDocumentLinks = (
  sourcePath: string,
  markdown: string,
  options: LinkCheckOptions = {}
): readonly LinkCheckFailure[] => {
  const failures: LinkCheckFailure[] = [];
  const sourceAnchors = collectAnchors(markdown);
  const targetExists =
    options.targetExists ??
    ((path: string) => existsSync(join(repoRoot, path)));
  const anchorsForPath = options.readAnchors ?? readAnchors;

  for (const link of extractMarkdownLinks(markdown)) {
    if (isExternalTarget(link.target) || link.target.length === 0) {
      continue;
    }

    const { anchor, path } = parseTarget(link.target);
    const targetPath = targetPathFor(sourcePath, path);

    if (!targetExists(targetPath)) {
      failures.push({
        ...link,
        message: `target does not exist: ${targetPath}`,
        sourcePath,
      });
      continue;
    }

    if (!anchor) {
      continue;
    }

    const anchors =
      targetPath === sourcePath ? sourceAnchors : anchorsForPath(targetPath);
    const normalizedAnchor = normalizeAnchor(anchor);
    if (!anchors.has(normalizedAnchor)) {
      failures.push({
        ...link,
        message: `anchor does not exist in ${targetPath}: #${normalizedAnchor}`,
        sourcePath,
      });
    }
  }

  return failures;
};

export const checkMarkdownLinks = (
  files: readonly string[] = discoverMarkdownFiles()
): readonly LinkCheckFailure[] =>
  files.flatMap((sourcePath) =>
    checkMarkdownDocumentLinks(
      sourcePath,
      readFileSync(join(repoRoot, sourcePath), 'utf8')
    )
  );

const main = () => {
  const files = discoverMarkdownFiles();
  const failures = checkMarkdownLinks(files);
  if (failures.length === 0) {
    console.log(
      `Markdown link check passed for ${String(files.length)} files.`
    );
    return;
  }

  for (const failure of failures) {
    console.error(
      `${failure.sourcePath}:${String(failure.line)}: ${failure.message} (${failure.text} -> ${failure.target})`
    );
  }
  process.exitCode = 1;
};

if (import.meta.main) {
  main();
}
