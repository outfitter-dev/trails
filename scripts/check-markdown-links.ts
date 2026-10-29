import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path';

import {
  extractMarkdownLinks,
  updateFenceState,
  unescapeMarkdownTarget,
} from '../.skillset/plugins/trails-dev/skills/trails-adrs/scripts/lib/markdown-links.ts';
import type { MarkdownLink } from '../.skillset/plugins/trails-dev/skills/trails-adrs/scripts/lib/markdown-links.ts';
export { extractMarkdownLinks } from '../.skillset/plugins/trails-dev/skills/trails-adrs/scripts/lib/markdown-links.ts';
export type { MarkdownLink } from '../.skillset/plugins/trails-dev/skills/trails-adrs/scripts/lib/markdown-links.ts';

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
const scanRoots = [
  'docs',
  'packages',
  'apps',
  'adapters',
  '.skillset',
] as const;
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
    const normalized = unescapeMarkdownTarget(link.target);
    if (isExternalTarget(normalized) || normalized.length === 0) {
      continue;
    }

    const { anchor, path } = parseTarget(normalized);
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
