/* oxlint-disable max-statements, no-negated-condition -- decision map assembly from multiple sources */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, relative } from 'node:path';
import {
  DRAFTS_DIR,
  DRAFTS_INDEX_PATH,
  DRAFTS_MAP_PATH,
  MAP_PATH,
  ROOT,
} from './paths.ts';
import { requireActivePath } from './active-paths.ts';
import { parseFrontmatter } from './frontmatter.ts';
import type { AdrFile } from './frontmatter.ts';
import { extractMarkdownLinks } from './markdown-links.ts';
import { resolveMarkdownFile } from './relative-links.ts';
import { listReferenceDocs } from './references.ts';
import {
  listNumberedAdrs,
  listDrafts,
  parseAdrNumber,
  padNumber,
} from './discovery.ts';

export interface InboundRef {
  from: string;
  fromPath: string;
  context: string;
}

export interface DecisionMapEntry {
  number: string | null;
  slug: string;
  title: string;
  status: string;
  created: string;
  updated: string;
  path: string;
  owners: string[];
  depends_on: string[];
  superseded_by: string[] | null;
  inbound: InboundRef[];
}

export interface DecisionMap {
  version: 1;
  entries: DecisionMapEntry[];
}

const indexInboundRefs = (allFiles: AdrFile[]): Map<string, InboundRef[]> => {
  const inbound = new Map(
    allFiles.map(({ path }) => [path, [] as InboundRef[]])
  );
  const sources = [
    ...allFiles.map((file) => {
      const number = parseAdrNumber(file.filename);
      return {
        body: file.body,
        from:
          number === null
            ? file.filename.replace(/^\d+-/, '').replace(/\.md$/, '')
            : padNumber(number),
        path: file.path,
      };
    }),
    ...listReferenceDocs().map(({ path, filename }) => ({
      body: parseFrontmatter(readFileSync(path, 'utf8')).body,
      from: basename(filename, '.md'),
      path,
    })),
  ];
  for (const { path, body, from } of sources) {
    const lines = body.split(/\r?\n/);
    const seen = new Set<string>();
    for (const { target, line } of extractMarkdownLinks(body)) {
      const resolved = resolveMarkdownFile(target, path, ROOT);
      if (!resolved || resolved === path || seen.has(resolved)) {
        continue;
      }
      const refs = inbound.get(resolved);
      if (refs) {
        seen.add(resolved);
        refs.push({
          context: (lines[line - 1] ?? '').trim().slice(0, 200),
          from,
          fromPath: relative(ROOT, path),
        });
      }
    }
  }
  for (const refs of inbound.values()) {
    refs.sort((a, b) => a.fromPath.localeCompare(b.fromPath));
  }
  return inbound;
};

/** Extract the date from a draft filename's YYYYMMDD prefix. */
export const dateFromFilename = (filename: string): string | null => {
  const match = filename.match(/^(\d{4})(\d{2})(\d{2})-/);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
};

/** Extract YYYY-MM from a draft filename. */
const monthFromFilename = (filename: string): string | null => {
  const match = filename.match(/^(\d{4})(\d{2})/);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2]}`;
};

const buildNumberedEntries = (
  inbound: Map<string, InboundRef[]>
): DecisionMapEntry[] =>
  listNumberedAdrs().map((adr): DecisionMapEntry => {
    const num = parseAdrNumber(adr.filename);
    const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
    return {
      created: String(adr.frontmatter.created ?? ''),
      depends_on: (adr.frontmatter.depends_on as string[]) ?? [],
      inbound: inbound.get(adr.path) ?? [],
      number: num !== null ? padNumber(num) : null,
      owners: (adr.frontmatter.owners as string[]) ?? [],
      path: `docs/adr/${adr.filename}`,
      slug,
      status: String(adr.frontmatter.status ?? 'unknown'),
      superseded_by: (adr.frontmatter.superseded_by as string[]) ?? null,
      title: adr.title.replace(/^ADR-\d+:\s*/, ''),
      updated: String(adr.frontmatter.updated ?? ''),
    };
  });

const buildDraftEntries = (
  inbound: Map<string, InboundRef[]>
): DecisionMapEntry[] =>
  listDrafts().map((adr): DecisionMapEntry => {
    const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
    const created = String(
      adr.frontmatter.created ?? dateFromFilename(adr.filename) ?? ''
    );
    return {
      created,
      depends_on: (adr.frontmatter.depends_on as string[]) ?? [],
      inbound: inbound.get(adr.path) ?? [],
      number: null,
      owners: (adr.frontmatter.owners as string[]) ?? [],
      path: `docs/adr/drafts/${adr.filename}`,
      slug,
      status: String(adr.frontmatter.status ?? 'draft'),
      superseded_by: (adr.frontmatter.superseded_by as string[]) ?? null,
      title: adr.title.replace(/^ADR:\s*/, ''),
      updated: String(
        adr.frontmatter.updated ?? dateFromFilename(adr.filename) ?? ''
      ),
    };
  });

/** Resolve a depends_on ref to a title and relative path (from drafts/). */
const resolveDep = (
  ref: string,
  numberedEntries: DecisionMapEntry[],
  draftEntries: DecisionMapEntry[]
): {
  title: string;
  path: string;
  isNumbered: boolean;
  sortKey: string;
} | null => {
  // Try as a number (accepted ADR)
  if (/^\d+$/.test(ref)) {
    const padded = padNumber(Number(ref));
    const entry = numberedEntries.find((e) => e.number === padded);
    if (entry) {
      return {
        isNumbered: true,
        path: `../${entry.number}-${entry.slug}.md`,
        sortKey: padded,
        title: `ADR-${entry.number}: ${entry.title}`,
      };
    }
  }

  // Try as a draft slug
  const entry = draftEntries.find((e) => e.slug === ref);
  if (entry) {
    const filename = basename(entry.path);
    return {
      isNumbered: false,
      path: filename,
      sortKey: entry.created + entry.slug,
      title: entry.title,
    };
  }

  return null;
};

/** Sort deps: numbered first (ascending), then drafts by date ascending. */
const sortDeps = (
  deps: string[],
  numbered: DecisionMapEntry[],
  drafts: DecisionMapEntry[]
): { title: string; path: string }[] => {
  const resolved = deps
    .map((ref) => resolveDep(ref, numbered, drafts))
    .filter((d): d is NonNullable<typeof d> => d !== null);

  return resolved.toSorted((a, b) => {
    if (a.isNumbered && !b.isNumbered) {
      return -1;
    }
    if (!a.isNumbered && b.isNumbered) {
      return 1;
    }
    return a.sortKey.localeCompare(b.sortKey);
  });
};

/** Build the drafts/README.md content. */
const buildDraftsIndex = (
  draftEntries: DecisionMapEntry[],
  numberedEntries: DecisionMapEntry[]
): string => {
  const lines: string[] = [
    '<!-- Generated by adr.ts — do not edit manually -->',
    '',
    '# Draft ADRs',
    '',
    'Proposed decisions under discussion. Promoted to `docs/adr/` when accepted.',
    '',
    'Draft map: `docs/adr/drafts/decision-map.json`; numbered map: `docs/adr/decision-map.json`.',
  ];

  // Group by YYYY-MM from created date
  const groups = new Map<string, DecisionMapEntry[]>();
  for (const entry of draftEntries) {
    const filename = basename(entry.path);
    const month =
      monthFromFilename(filename) ?? entry.created.slice(0, 7) ?? 'unknown';
    const existing = groups.get(month);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(month, [entry]);
    }
  }

  // Sort months ascending
  const sortedMonths = [...groups.keys()].toSorted();

  for (const month of sortedMonths) {
    const entries = groups.get(month);
    if (!entries) {
      continue;
    }

    lines.push('', `## ${month}`, '');

    for (const entry of entries) {
      const filename = basename(entry.path);
      lines.push(`- [${entry.title}](${filename})`);

      if (entry.depends_on.length > 0) {
        const sorted = sortDeps(
          entry.depends_on,
          numberedEntries,
          draftEntries
        );
        const depLinks = sorted
          .map((d) => `[${d.title}](${d.path})`)
          .join(', ');
        lines.push(`  - depends on ${depLinks}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
};

const jsonIndent = (depth: number): string => '  '.repeat(depth);

const isJsonPrimitive = (value: unknown): boolean =>
  value === null || typeof value !== 'object';

const stringifyFormattedJson = (
  value: unknown,
  depth = 0,
  linePrefixLength = 0
): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    if (value.every(isJsonPrimitive)) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
      if (jsonIndent(depth).length + linePrefixLength + inline.length <= 80) {
        return inline;
      }
      const nextDepth = depth + 1;
      return `[\n${value
        .map((item) => `${jsonIndent(nextDepth)}${JSON.stringify(item)}`)
        .join(',\n')}\n${jsonIndent(depth)}]`;
    }
    const nextDepth = depth + 1;
    return `[\n${value
      .map(
        (item) =>
          `${jsonIndent(nextDepth)}${stringifyFormattedJson(item, nextDepth)}`
      )
      .join(',\n')}\n${jsonIndent(depth)}]`;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }
    const nextDepth = depth + 1;
    return `{\n${entries
      .map(([key, item]) => {
        const keyPrefix = `${jsonIndent(nextDepth)}${JSON.stringify(key)}: `;
        return `${keyPrefix}${stringifyFormattedJson(
          item,
          nextDepth,
          keyPrefix.length - jsonIndent(nextDepth).length
        )}`;
      })
      .join(',\n')}\n${jsonIndent(depth)}}`;
  }

  return JSON.stringify(value);
};

/**
 * Build all generated ADR artifacts:
 * - docs/adr/decision-map.json (accepted ADRs only — stable)
 * - docs/adr/drafts/decision-map.json (drafts only — changes with drafts)
 * - docs/adr/drafts/README.md (generated index)
 */
export const buildDecisionMapContents = (): readonly {
  readonly path: string;
  readonly content: string;
}[] => {
  const inbound = indexInboundRefs([...listNumberedAdrs(), ...listDrafts()]);
  const numberedEntries = buildNumberedEntries(inbound);
  const draftEntries = buildDraftEntries(inbound);

  const acceptedMap: DecisionMap = { entries: numberedEntries, version: 1 };
  const draftsMap: DecisionMap = { entries: draftEntries, version: 1 };
  const draftsIndex = buildDraftsIndex(draftEntries, numberedEntries);

  return [
    { content: `${stringifyFormattedJson(acceptedMap)}\n`, path: MAP_PATH },
    {
      content: `${stringifyFormattedJson(draftsMap)}\n`,
      path: DRAFTS_MAP_PATH,
    },
    { content: draftsIndex, path: DRAFTS_INDEX_PATH },
  ];
};

/** Write all generated ADR artifacts. */
export const writeDecisionMap = (): void => {
  const artifacts = buildDecisionMapContents();
  for (const artifact of artifacts) {
    requireActivePath(artifact.path);
  }
  mkdirSync(DRAFTS_DIR, { recursive: true });

  for (const artifact of artifacts) {
    writeFileSync(artifact.path, artifact.content, 'utf8');
    console.log(`Updated ${artifact.path}`);
  }
};
