#!/usr/bin/env bun
/**
 * Scratch-doc inventory manifest generator.
 *
 * Walks the working-doc corpus, parses the frontmatter the inventory passes
 * authored (created / updated / description / references / impl_status / linear,
 * plus ADR-native title / status / depends_on), extracts the first H1 from the
 * body, and emits a single JSON manifest that is easier to scan than the tree.
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

type Entry = {
  path: string;
  h1: string | null;
  title: string | null;
  description: string | null;
  created: string | null;
  updated: string | null;
  impl_status: string | null;
  adr_status: string | null;
  references: string[];
  linear: string[];
  depends_on: string[];
  supersedes: string[];
  superseded_by: string | null;
};

function walk(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/** Split a file into [frontmatterLines, bodyText]. */
function splitFrontmatter(text: string): [string[], string] {
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
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parseInlineList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner === '') {
    return [];
  }
  return inner
    .split(',')
    .map((s) => stripQuotes(s))
    .filter(Boolean);
}

/**
 * Minimal frontmatter parser for our flat schema:
 *   key: scalar
 *   key: [a, b]      (inline list)
 *   key:             (block list)
 *     - a
 * Comments (`# ...`) and `null` are normalized.
 */
function parseFrontmatter(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    if (/^\s+-\s+/.test(line)) {
      continue; // consumed by block-list lookahead
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
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map(String);
  }
  if (typeof v === 'string' && v) {
    return [v];
  }
  return [];
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function firstH1(body: string): string | null {
  for (const line of body.split('\n')) {
    const m = /^#\s+(.+)$/.exec(line);
    if (m) {
      return m[1].trim();
    }
  }
  return null;
}

const files = ROOTS.flatMap((r) => walk(join(REPO_ROOT, r))).sort();
const entries: Entry[] = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const [fmLines, body] = splitFrontmatter(text);
  const fm = parseFrontmatter(fmLines);
  entries.push({
    path: relative(REPO_ROOT, file),
    h1: firstH1(body),
    title: asStr(fm.title),
    description: asStr(fm.description),
    created: asStr(fm.created),
    updated: asStr(fm.updated),
    impl_status: asStr(fm.impl_status),
    adr_status: asStr(fm.status),
    references: asList(fm.references),
    linear: asList(fm.linear),
    depends_on: asList(fm.depends_on),
    supersedes: asList(fm.supersedes),
    superseded_by: asStr(fm.superseded_by),
  });
}

const byStatus: Record<string, number> = {};
for (const e of entries) {
  const key = e.impl_status ?? 'none';
  byStatus[key] = (byStatus[key] ?? 0) + 1;
}

const manifest = {
  generated: new Date().toISOString(),
  root: relative(process.cwd(), REPO_ROOT) || '.',
  count: entries.length,
  by_impl_status: byStatus,
  missing_created: entries.filter((e) => !e.created).length,
  missing_description: entries.filter((e) => !e.description).length,
  entries,
};

writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `Wrote ${OUT}\n${manifest.count} docs · impl_status ${JSON.stringify(byStatus)} · ${manifest.missing_description} missing description\n`
);
