/* oxlint-disable max-statements -- cross-reference scanning and rewriting */

import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ROOT } from './paths.ts';
import { listNumberedAdrs, listDrafts } from './discovery.ts';
import { parseFrontmatter, serializeAdrDocument } from './frontmatter.ts';
import type { Frontmatter } from './frontmatter.ts';
import { retargetLocalLinks } from './relative-links.ts';

/** Non-ADR documentation that may link to decisions. */
export const listReferenceDocs = (): { path: string; filename: string }[] => {
  const files: { path: string; filename: string }[] = [];
  const docsDir = join(ROOT, 'docs');
  const adrDir = join(docsDir, 'adr');
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && path !== adrDir) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push({ filename: entry.name, path });
      }
    }
  };
  visit(docsDir);
  const agentsPath = join(ROOT, 'AGENTS.md');
  if (lstatSync(agentsPath, { throwIfNoEntry: false })?.isFile()) {
    files.push({ filename: 'AGENTS.md', path: agentsPath });
  }
  return files;
};

/** Retarget Markdown links to the exact moved document. */
export const rewriteMovedLinks = (from: string, to: string): void => {
  for (const file of [
    ...listNumberedAdrs(),
    ...listDrafts(),
    ...listReferenceDocs(),
  ]) {
    if (!lstatSync(file.path, { throwIfNoEntry: false })?.isFile()) {
      continue;
    }
    const raw = readFileSync(file.path, 'utf8');
    const { body } = parseFrontmatter(raw);
    const after = retargetLocalLinks(body, file.path, from, to, ROOT);
    if (after !== body) {
      writeFileSync(
        file.path,
        raw.slice(0, raw.length - body.length) + after,
        'utf8'
      );
      console.log(`  ${file.filename}: ${basename(from)} → ${basename(to)}`);
    }
  }
};

/** Fields in frontmatter that may contain slug references to other ADRs. */
const SLUG_REF_FIELDS = ['depends_on', 'superseded_by'] as const;

/**
 * Rewrite a single frontmatter object's slug-based references to numeric
 * references. Returns a new frontmatter object and a `changed` flag so
 * callers can decide whether to rewrite the file on disk.
 *
 * Pure helper extracted for testability.
 */
export const rewriteSlugRefsInFrontmatter = (
  fm: Frontmatter,
  promotedSlug: string,
  promotedNumber: number
): { frontmatter: Frontmatter; changed: boolean } => {
  const numericRef = String(promotedNumber);
  const updated: Frontmatter = { ...fm };
  let changed = false;

  for (const field of SLUG_REF_FIELDS) {
    const current = updated[field];
    if (!Array.isArray(current)) {
      continue;
    }
    const rewritten = current.map((entry) =>
      typeof entry === 'string' && entry === promotedSlug ? numericRef : entry
    );
    const hasChange = rewritten.some((entry, idx) => entry !== current[idx]);
    if (hasChange) {
      (updated as Record<string, unknown>)[field] = rewritten;
      changed = true;
    }
  }

  return { changed, frontmatter: updated };
};

/**
 * Rewrite frontmatter references from a promoted draft's slug to its new
 * numeric id. Scans all remaining drafts and rewrites entries in their
 * `depends_on`, `superseded_by`, and any array fields that may reference
 * ADRs by slug.
 *
 * The rewrite is a structural fix: without it, promoting a draft leaves
 * every other draft that referenced it by slug pointing at a decision the
 * generated decision map can no longer resolve.
 */
export const rewriteFrontmatterSlugRefs = (
  promotedSlug: string,
  promotedNumber: number
): void => {
  for (const draft of listDrafts()) {
    const { frontmatter, changed } = rewriteSlugRefsInFrontmatter(
      draft.frontmatter,
      promotedSlug,
      promotedNumber
    );
    if (!changed) {
      continue;
    }
    const content = serializeAdrDocument(draft.raw, frontmatter, draft.body);
    writeFileSync(draft.path, content, 'utf8');
    console.log(
      `  ${draft.filename}: frontmatter refs ${promotedSlug} → ${promotedNumber}`
    );
  }
};
