/* oxlint-disable max-statements -- ADR resolution with multiple lookup strategies */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ADR_DIR, DRAFTS_DIR } from './paths.ts';
import { parseFrontmatter, extractTitle } from './frontmatter.ts';
import type { AdrFile } from './frontmatter.ts';

export const readAdr = (path: string): AdrFile => {
  const raw = readFileSync(path, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    body,
    filename: basename(path),
    frontmatter,
    path,
    raw,
    title: extractTitle(body),
  };
};

export const listNumberedAdrs = (): AdrFile[] => {
  if (!existsSync(ADR_DIR)) {
    return [];
  }
  return readdirSync(ADR_DIR)
    .filter((f) => /^\d+-.*\.md$/.test(f) && f !== 'README.md')
    .toSorted()
    .map((f) => readAdr(join(ADR_DIR, f)));
};

export const listDrafts = (): AdrFile[] => {
  if (!existsSync(DRAFTS_DIR)) {
    return [];
  }
  return readdirSync(DRAFTS_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .toSorted()
    .map((f) => readAdr(join(DRAFTS_DIR, f)));
};

export const parseAdrNumber = (filename: string): number | null => {
  const match = filename.match(/^(\d+)-/);
  return match ? Number(match[1]) : null;
};

export const nextAdrNumber = (): number => {
  const adrs = listNumberedAdrs();
  let max = 0;
  for (const adr of adrs) {
    const n = parseAdrNumber(adr.filename);
    if (n !== null && n > max) {
      max = n;
    }
  }
  return max + 1;
};

export const padNumber = (n: number): string => String(n).padStart(4, '0');

export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const todayCompact = (): string => today().replaceAll('-', '');

export const resolveAdr = (ref: string): AdrFile | null => {
  // Direct path
  if (ref.endsWith('.md') && existsSync(ref)) {
    return readAdr(resolve(ref));
  }

  // Check drafts by slug
  for (const draft of listDrafts()) {
    const slug = draft.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
    if (
      slug === ref ||
      draft.filename === ref ||
      draft.filename === `${ref}.md`
    ) {
      return draft;
    }
  }

  // Check numbered by number or slug
  for (const adr of listNumberedAdrs()) {
    const num = parseAdrNumber(adr.filename);
    const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
    if (slug === ref || adr.filename === ref || adr.filename === `${ref}.md`) {
      return adr;
    }
    if (num !== null && (String(num) === ref || padNumber(num) === ref)) {
      return adr;
    }
  }

  return null;
};
