#!/usr/bin/env bun
/**
 * Scratch-doc inventory manifest generator.
 *
 * Walks the working-doc corpus, parses the inventory frontmatter (created /
 * updated / description / references / impl_status / linear, plus ADR-native
 * title / status / depends_on), extracts the first H1 from the body, and emits
 * a single JSON manifest that is easier to scan than the tree.
 *
 * Dependency-free on purpose: a minimal frontmatter reader for our own
 * known-shape blocks, so this runs with bare `bun` in any checkout (no install).
 *
 * Usage:  bun scripts/scratch-inventory/build-manifest.ts
 * Output: scripts/scratch-inventory/manifest.json  (gitignored)
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const ROOTS = ['.scratch', '.agents/plans', '.agents/notes', 'docs/adr/drafts'];
const OUT = join(import.meta.dir, 'manifest.json');

interface Entry {
  adr_status: string | null;
  created: string | null;
  depends_on: string[];
  description: string | null;
  h1: string | null;
  impl_status: string | null;
  linear: string[];
  path: string;
  references: string[];
  superseded_by: string | null;
  supersedes: string[];
  title: string | null;
  updated: string | null;
}

const walk = (dir: string): string[] => {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
};

const splitFrontmatter = (text: string): [string[], string] => {
  if (!text.startsWith('---')) {
    return [[], text];
  }
  const lines = text.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return [[], text];
  }
  return [lines.slice(1, end), lines.slice(end + 1).join('\n')];
};

const stripQuotes = (value: string): string => {
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
};

const parseInlineList = (value: string): string[] => {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner === '') {
    return [];
  }
  return inner
    .split(',')
    .map((entry) => stripQuotes(entry))
    .filter(Boolean);
};

const parseFrontmatter = (lines: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    if (/^\s+-\s+/.test(line)) {
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    let rest = line.slice(colon + 1).trim();
    const hash = rest.indexOf(' #');
    if (hash !== -1) {
      rest = rest.slice(0, hash).trim();
    }
    if (rest === '') {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
        items.push(stripQuotes(lines[j].replace(/^\s+-\s+/, '')));
        j += 1;
      }
      out[key] = items;
      i = j - 1;
    } else if (rest.startsWith('[')) {
      out[key] = parseInlineList(rest);
    } else if (rest === 'null' || rest === '~') {
      out[key] = null;
    } else {
      out[key] = stripQuotes(rest);
    }
  }
  return out;
};

const asList = (v: unknown): string[] => {
  if (Array.isArray(v)) {
    return v.map(String);
  }
  if (typeof v === 'string' && v) {
    return [v];
  }
  return [];
};

const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const firstH1 = (body: string): string | null => {
  for (const line of body.split('\n')) {
    const m = /^#\s+(.+)$/.exec(line);
    if (m) {
      return m[1].trim();
    }
  }
  return null;
};

const files = ROOTS.flatMap((r) => walk(join(REPO_ROOT, r))).toSorted();
const entries: Entry[] = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const [fmLines, body] = splitFrontmatter(text);
  const fm = parseFrontmatter(fmLines);
  entries.push({
    adr_status: asStr(fm.status),
    created: asStr(fm.created),
    depends_on: asList(fm.depends_on),
    description: asStr(fm.description),
    h1: firstH1(body),
    impl_status: asStr(fm.impl_status),
    linear: asList(fm.linear),
    path: relative(REPO_ROOT, file),
    references: asList(fm.references),
    superseded_by: asStr(fm.superseded_by),
    supersedes: asList(fm.supersedes),
    title: asStr(fm.title),
    updated: asStr(fm.updated),
  });
}

const byStatus: Record<string, number> = {};
for (const e of entries) {
  const key = e.impl_status ?? 'none';
  byStatus[key] = (byStatus[key] ?? 0) + 1;
}

const manifest = {
  by_impl_status: byStatus,
  count: entries.length,
  entries,
  generated: new Date().toISOString(),
  missing_created: entries.filter((e) => !e.created).length,
  missing_description: entries.filter((e) => !e.description).length,
  root: relative(process.cwd(), REPO_ROOT) || '.',
};

writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `Wrote ${OUT}\n${manifest.count} docs · impl_status ${JSON.stringify(byStatus)} · ${manifest.missing_description} missing description\n`
);
