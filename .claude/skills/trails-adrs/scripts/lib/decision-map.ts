/* oxlint-disable max-statements, no-negated-condition -- decision map assembly from multiple sources */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  DRAFTS_DIR,
  DRAFTS_INDEX_PATH,
  DRAFTS_MAP_PATH,
  MAP_PATH,
  ROOT,
} from './paths.ts';
import type { AdrFile } from './frontmatter.ts';
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

/** List non-ADR markdown files that may reference ADR filenames. */
const listDocFiles = (): { path: string; filename: string }[] => {
  const files: { path: string; filename: string }[] = [];

  // docs/*.md (non-recursive — subdirs are ADR-managed)
  const docsDir = join(ROOT, 'docs');
  for (const f of readdirSync(docsDir)) {
    if (f.endsWith('.md')) {
      files.push({ filename: f, path: join(docsDir, f) });
    }
  }

  // AGENTS.md at repo root
  const agentsPath = join(ROOT, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    files.push({ filename: 'AGENTS.md', path: agentsPath });
  }

  return files;
};

/** Scan all ADR files and non-ADR docs for references to a given filename. */
export const findInboundRefs = (
  targetFilename: string,
  allFiles: AdrFile[]
): InboundRef[] => {
  const refs: InboundRef[] = [];

  // Scan ADR files
  for (const file of allFiles) {
    if (file.filename === targetFilename) {
      continue;
    }
    const content = readFileSync(file.path, 'utf8');
    for (const line of content.split('\n')) {
      if (line.includes(targetFilename)) {
        const fromSlug = file.filename
          .replace(/^\d+-/, '')
          .replace(/\.md$/, '');
        const fromNum = parseAdrNumber(file.filename);
        refs.push({
          context: line.trim().slice(0, 200),
          from: fromNum !== null ? padNumber(fromNum) : fromSlug,
          fromPath: file.path.includes('/drafts/')
            ? `docs/adr/drafts/${file.filename}`
            : `docs/adr/${file.filename}`,
        });
        break;
      }
    }
  }

  // Scan non-ADR docs
  for (const doc of listDocFiles()) {
    const content = readFileSync(doc.path, 'utf8');
    for (const line of content.split('\n')) {
      if (line.includes(targetFilename)) {
        const relPath = doc.path.startsWith(ROOT)
          ? doc.path.slice(ROOT.length + 1)
          : doc.filename;
        refs.push({
          context: line.trim().slice(0, 200),
          from: basename(doc.filename, '.md'),
          fromPath: relPath,
        });
        break;
      }
    }
  }

  // Sort for determinism: by fromPath
  return refs.toSorted((a, b) => a.fromPath.localeCompare(b.fromPath));
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

const buildNumberedEntries = (allFiles: AdrFile[]): DecisionMapEntry[] =>
  listNumberedAdrs().map((adr): DecisionMapEntry => {
    const num = parseAdrNumber(adr.filename);
    const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
    return {
      created: String(adr.frontmatter.created ?? ''),
      depends_on: (adr.frontmatter.depends_on as string[]) ?? [],
      inbound: findInboundRefs(adr.filename, allFiles),
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

const buildDraftEntries = (allFiles: AdrFile[]): DecisionMapEntry[] =>
  listDrafts().map((adr): DecisionMapEntry => {
    const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
    const created = String(
      adr.frontmatter.created ?? dateFromFilename(adr.filename) ?? ''
    );
    return {
      created,
      depends_on: (adr.frontmatter.depends_on as string[]) ?? [],
      inbound: findInboundRefs(adr.filename, allFiles),
      number: null,
      owners: (adr.frontmatter.owners as string[]) ?? [],
      path: `docs/adr/drafts/${adr.filename}`,
      slug,
      status: String(adr.frontmatter.status ?? 'draft'),
      superseded_by: null,
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

const writeJson = (path: string, data: unknown): void => {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

/**
 * Write all generated ADR artifacts:
 * - docs/adr/decision-map.json (accepted ADRs only — stable)
 * - docs/adr/drafts/decision-map.json (drafts only — changes with drafts)
 * - docs/adr/drafts/README.md (generated index)
 */
export const writeDecisionMap = (): void => {
  const allFiles = [...listNumberedAdrs(), ...listDrafts()];
  const numberedEntries = buildNumberedEntries(allFiles);
  const draftEntries = buildDraftEntries(allFiles);

  // Accepted ADR map (stable — only changes when ADRs are promoted/modified)
  const acceptedMap: DecisionMap = { entries: numberedEntries, version: 1 };
  writeJson(MAP_PATH, acceptedMap);
  console.log(`Updated ${MAP_PATH}`);

  // Drafts map (changes with draft edits)
  mkdirSync(DRAFTS_DIR, { recursive: true });
  const draftsMap: DecisionMap = { entries: draftEntries, version: 1 };
  writeJson(DRAFTS_MAP_PATH, draftsMap);
  console.log(`Updated ${DRAFTS_MAP_PATH}`);

  // Drafts README
  const draftsIndex = buildDraftsIndex(draftEntries, numberedEntries);
  writeFileSync(DRAFTS_INDEX_PATH, draftsIndex, 'utf8');
  console.log(`Updated ${DRAFTS_INDEX_PATH}`);
};
